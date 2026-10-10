const os = require('node:os');
const original = os.userInfo;
os.userInfo = function(options) {
  try { return original(options); }
  catch(error) {
    if(error.code!=='ERR_SYSTEM_ERROR') throw error;
    return { username:'local',homedir:process.env.USERPROFILE||process.cwd(),uid:0,gid:0,shell:null };
  }
};
require('node:module').syncBuiltinESMExports();
