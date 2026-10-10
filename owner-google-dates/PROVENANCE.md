# מקורות ומגבלות — 2026-10-04

הוכן קוד מקור בלבד. עבור החבילה הזאת לא בוצעו קריאה או כתיבה ב-Google Forms או Sheets, פעולת OAuth, פרסום, שליחת תשובה או התקנת מפעיל. התיעוד הרשמי נקרא באמצעות כלי אינטרנט; קבצים מקומיים סיפקו את מזהי היעד ואת מבנה הנתונים הצפוי.

ראיות מקומיות:

- `work/project-state.json`: מזהי טפסים א/ב וגיליונות, כותרות עם תאריכים מראשון עד שבת, עמודת D ההיסטורית, נוסחת השבוע האוטומטי L2 והתלות של heartbeat Codex הנוכחי במחשב המקומי.
- `work/availability-make-ready/native-validation.json` ו-`mapping-fields.json`: מזהי gid של לשוניות התשובות ומיפוי המקור A:L.
- `outputs/03_forms-connection-check.md`: בדיקת החיבורים מ-2026-10-04; היא מציינת במפורש שהעברת תשובות הטפסים מקצה לקצה לא אומתה.
- `outputs/אמירו_גרין_המשך_הפרויקט.md`: תיעוד שדות שם וטלפון ובחירות checkbox של בוקר, צהריים ולילה.

המבנה המדויק של טופס עם שלושה פריטים, מחרוזות עמודות הטבלה, האיות של כותרת הזמן, מחרוזת נוסחת L2 המדויקת ואזור הזמן של הגיליון הם תנאים מקדימים שמרניים בזמן ההפעלה. הם לא נקראו באופן עצמאי בחיבור חי במהלך המשימה הזאת. אי התאמה חוסמת כתיבה; אין תיקון אוטומטי של מבנה, נוסחה או אזור זמן.

מקורות רשמיים ראשוניים:

- [`CheckboxGridItem.getRows/getColumns/setRows`](https://developers.google.com/apps-script/reference/forms/checkbox-grid-item): קריאה וכתיבה של כותרות השורות בטבלה הקיימת. התיעוד אינו מגדיר איך הגיליון המקושר שומר על עמודות או משנה את שמותיהן.
- [`Form.getDestinationType/getDestinationId/getItems`](https://developers.google.com/apps-script/reference/forms/form): בדיקת הגיליון המקושר ומבנה השאלות.
- [`ClockTriggerBuilder.atHour/nearMinute/everyDays/inTimezone/create`](https://developers.google.com/apps-script/reference/script/clock-trigger-builder): יצירת מפעיל זמן יומי; ל-`nearMinute` יש טווח של כ-15 דקות ונדרשת תדירות.
- [מפעילים הניתנים להתקנה](https://developers.google.com/apps-script/guides/triggers/installable): זמני הפעלה יכולים להיות אקראיים; מפעילים רצים בהרשאות יוצריהם.
- [`ScriptApp.getProjectTriggers/deleteTrigger`](https://developers.google.com/apps-script/reference/script/script-app): רשימת מפעילי הפרויקט והמשתמש הנוכחיים והסרת מפעיל נבחר.
- [`Sheet.getSheetId/getLastColumn/getLastRow`](https://developers.google.com/apps-script/reference/spreadsheet/sheet) ו-[`Range.getValues/getFormulas/getFormula/setValues`](https://developers.google.com/apps-script/reference/spreadsheet/range): בדיקת לשונית וטווחים קבועים וכתיבת שבעת תאי הכותרת כמטריצה 1×7.
- [`Utilities.formatDate/computeDigest`](https://developers.google.com/apps-script/reference/utilities/utilities) ו-[`LockService.getScriptLock`](https://developers.google.com/apps-script/reference/lock/lock-service): בחירת יום מקומי בלוח השנה, בדיקת טביעות תאים קיימים ומניעת ריצות מקבילות של הסקריפט עצמו.

אין הנחה שעמודות תשובות היסטוריות נוספות אוטומטית או ששמותיהן משתנים אוטומטית. שינויים מובנים יכולים להתרחש לפני כישלון הבדיקות שלאחר הפעולה ובאופן אסינכרוני; הפעולה אינה עסקה משותפת של Forms ו-Sheets. לפני הפעלת כתיבה על הבעלים לבדוק עותק בעל מבנה זהה שבו מתבצע שינוי אמיתי של כותרות השורות. תקלות חוסמות ניסיון חוזר במקום לשחזר שינויים שאולי נעשו בידי אדם במקביל. ברירת המחדל שנמסרה היא קריאה בלבד, ואין מפעיל יומי.
