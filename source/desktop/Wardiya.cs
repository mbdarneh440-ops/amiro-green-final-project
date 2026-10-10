using System;
using System.IO;
using System.Net;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Reflection;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("ורדיה")]
[assembly: AssemblyDescription("ניהול צוותי אבטחה")]
[assembly: AssemblyProduct("ורדיה")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

namespace WardiyaDesktop {
 static class Program {
  [STAThread] static void Main() {
   Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
   Application.Run(new WardiyaWindow());
  }
 }
 sealed class WardiyaWindow : Form {
  readonly string root=AppDomain.CurrentDomain.BaseDirectory;
  readonly Label status=new Label(); readonly WebView2 view=new WebView2();
  Process launcher; string localOrigin; bool closing; readonly CancellationTokenSource cancel=new CancellationTokenSource();
  public WardiyaWindow() {
   Text="ורדיה — ניהול צוותי אבטחה"; Width=1440; Height=930; MinimumSize=new Size(1000,680);
   StartPosition=FormStartPosition.CenterScreen; BackColor=Color.FromArgb(244,247,248);
   try { Icon=new Icon(Path.Combine(root,"desktop","wardiya.ico")); } catch {}
   status.Dock=DockStyle.Fill;status.TextAlign=ContentAlignment.MiddleCenter;status.Font=new Font("Segoe UI",16);
   status.ForeColor=Color.FromArgb(18,46,61);status.RightToLeft=RightToLeft.Yes;
   status.Text="ורדיה נפתחת…\nהנתונים נשמרים במחשב הזה."; Controls.Add(status);
   view.Dock=DockStyle.Fill;view.Visible=false;Controls.Add(view);
   Shown+=async delegate {await Start();}; FormClosed+=delegate {closing=true;cancel.Cancel();view.Dispose();StopOwnedServer();};
  }
  string FindNode() {
   var candidates=new List<string>{Path.Combine(root,"runtime","node.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".cache","codex-runtimes","codex-primary-runtime","dependencies","node","bin","node.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"nodejs","node.exe")};
   foreach(var dir in (Environment.GetEnvironmentVariable("PATH")??"").Split(';')) {try{candidates.Add(Path.Combine(dir,"node.exe"));}catch{}}
   foreach(var path in candidates) {
    if(!File.Exists(path))continue;
    try {
     var version=FileVersionInfo.GetVersionInfo(path);
     if(version.FileMajorPart>22||(version.FileMajorPart==22&&version.FileMinorPart>=13))return path;
    } catch {}
   }
   throw new Exception("לא נמצאה גרסה מתאימה של Node.js במחשב. יש להתקין Node.js 22.13 ומעלה ואז לפתוח שוב את ורדיה.");
  }
  async Task Start() {
   try {
    if(!File.Exists(Path.Combine(root,"package.json")))throw new Exception("יש לפתוח את ורדיה מתוך תיקיית הקוד המלאה.");
    Directory.CreateDirectory(Path.Combine(root,".sites-runtime"));
    var info=new ProcessStartInfo(FindNode(),"\""+Path.Combine(root,"scripts","start-local.mjs")+"\" --no-open");
    info.WorkingDirectory=root; info.UseShellExecute=false;info.CreateNoWindow=true;info.WindowStyle=ProcessWindowStyle.Hidden;
    info.RedirectStandardOutput=true;info.RedirectStandardError=true;info.StandardOutputEncoding=System.Text.Encoding.UTF8;info.StandardErrorEncoding=System.Text.Encoding.UTF8;
    launcher=new Process();launcher.StartInfo=info;launcher.OutputDataReceived+=Log;launcher.ErrorDataReceived+=Log;
    launcher.Start();launcher.BeginOutputReadLine();launcher.BeginErrorReadLine();
    string url=null;
    for(int i=0;i<300&&!closing;i++) {
     url=await ReadyUrl(); if(url!=null)break;
     if(launcher.HasExited&&launcher.ExitCode!=0)throw new Exception("לא ניתן להפעיל את ורדיה. פרטי התקלה נשמרו בקובץ desktop.log בתיקיית ‎.sites-runtime.");
     if(i==10)status.Text="מכינים את ורדיה…\nבהפעלה הראשונה ההכנה עשויה להימשך כמה דקות.";
     await Task.Delay(1000,cancel.Token);
    }
    if(closing)return;if(url==null)throw new Exception("תם הזמן להמתנה לפתיחת ורדיה. אפשר לסגור ולפתוח שוב.");
    localOrigin=new Uri(url).GetLeftPart(UriPartial.Authority);
    var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(root,".sites-runtime","desktop-profile"));
    await view.EnsureCoreWebView2Async(environment);
    view.CoreWebView2.Settings.IsWebMessageEnabled=false;view.CoreWebView2.Settings.AreHostObjectsAllowed=false;
    view.CoreWebView2.Settings.AreDefaultContextMenusEnabled=true;
    view.CoreWebView2.NewWindowRequested+=delegate(object sender,CoreWebView2NewWindowRequestedEventArgs e){e.Handled=true;OpenExternal(e.Uri);};
    view.CoreWebView2.NavigationStarting+=delegate(object sender,CoreWebView2NavigationStartingEventArgs e){Uri dest;if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out dest)||dest.GetLeftPart(UriPartial.Authority)!=localOrigin){e.Cancel=true;OpenExternal(e.Uri);}};
    view.CoreWebView2.NavigationCompleted+=delegate(object sender,CoreWebView2NavigationCompletedEventArgs e){if(closing)return;if(e.IsSuccess){view.Visible=true;status.Visible=false;}else if(e.WebErrorStatus!=CoreWebView2WebErrorStatus.OperationCanceled){view.Visible=false;status.Text="העמוד לא נטען. יש לסגור את ורדיה ולפתוח שוב.";status.Visible=true;status.BringToFront();}};
    view.CoreWebView2.Navigate(url+"signin-with-chatgpt?return_to=/");
   } catch(OperationCanceledException) {} catch(Exception e) {if(!closing){status.Text=e.Message;MessageBox.Show(this,e.Message,"ורדיה",MessageBoxButtons.OK,MessageBoxIcon.Information);}}
  }
  async Task<string> ReadyUrl() {
   try {
    string file=Path.Combine(root,".sites-runtime","local-server.json");if(!File.Exists(file))return null;
    var meta=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(file));
    if(!String.Equals(Path.GetFullPath((string)meta["root"]).TrimEnd('\\','/'),Path.GetFullPath(root).TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase))return null;
    Process.GetProcessById(Convert.ToInt32(meta["pid"]));var url=(string)meta["url"];var uri=new Uri(url);
    if(uri.Scheme!="http"||uri.Host!="127.0.0.1"||uri.Port<5173||uri.Port>5182||uri.AbsolutePath!="/")return null;
    var request=(HttpWebRequest)WebRequest.Create(url+"api/workspace");request.AllowAutoRedirect=false;request.Proxy=null;
    using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancel.Token)) {
     timeout.CancelAfter(1800);
     using(timeout.Token.Register(delegate {request.Abort();})) {
      HttpWebResponse response=null;
      try {response=(HttpWebResponse)await request.GetResponseAsync();}
      catch(WebException e) {response=e.Response as HttpWebResponse;}
      using(response) {
       if(response==null||response.StatusCode!=HttpStatusCode.Unauthorized)return null;
       using(var reader=new StreamReader(response.GetResponseStream())) {
        var body=await reader.ReadToEndAsync();
        var data=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(body);
        return data.ContainsKey("error")?url:null;
       }
      }
     }
    }
   } catch {return null;}
  }
  void Log(object sender,DataReceivedEventArgs e){if(e.Data==null)return;try{lock(status){File.AppendAllText(Path.Combine(root,".sites-runtime","desktop.log"),e.Data+Environment.NewLine,System.Text.Encoding.UTF8);}}catch{}}
  void OpenExternal(string value){Uri url;if(Uri.TryCreate(value,UriKind.Absolute,out url)&&(url.Scheme=="https"||url.Scheme=="http")){try{Process.Start(new ProcessStartInfo(url.AbsoluteUri){UseShellExecute=true});}catch{}}}
  void StopOwnedServer(){try{if(launcher!=null&&!launcher.HasExited){var info=new ProcessStartInfo("taskkill.exe","/PID "+launcher.Id+" /T /F"){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden};Process.Start(info);}launcher.Dispose();}catch{}}
 }
}
