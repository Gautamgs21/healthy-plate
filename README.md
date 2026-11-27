# Healthy Plate

## Update: iPhone notifications (step 2 of 3)

### What is new
- The app can now send health alerts to your iPhone even when it is closed: a test result outside the reference range, medicine supply running low (3 days or less), and an overdue health check-up.
- A **Notifications** button in the profile sheet (person icon) lets you turn alerts on or off for this phone, pick which alerts you want, set your time zone (default Asia/Kolkata), send a test, see your devices and the recent delivery history.
- Tapping a notification opens the right page in the app.
- Failed or expired phones are removed automatically.

### Things to know (honest limits)
- iPhone only allows notifications for apps added to the Home Screen (iOS 16.4 or later). The app shows these steps itself if you open it in Safari.
- These are best-effort alerts, not alarms. They can be delayed or silenced by Focus modes or Low Power Mode, and they are not the same as the Clock app.
- Test-result alerts are sent when you save the result. Medicine and check-up alerts are checked once a day, around 9 AM India time (Vercel's free plan allows one scheduled run per day). Scheduled reminders at exact times come in step 3 and need an external scheduler.
- This was tested with a simulated push service and a browser. I could not test on a real iPhone, so your first test message is the real check.

### Deploy steps
1. Open `https://YOUR-SITE.vercel.app/setup-keys.html` and tap the button to make the keys.
2. In Vercel, go to Settings > Environment Variables and add:
   - `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (from the page above)
   - `VAPID_SUBJECT` = `mailto:you@example.com` (your email)
   - `CRON_SECRET` = any long random text
   - `AUTH_SECRET` if you have not added it already
3. Upload the changed files to GitHub: `index.html`, `sw.js`, `vercel.json`, `package.json`, `js/notify.js`, `js/dash.js`, `api/push.js`, `api/cron.js`, `lib/*`, `shared/*`, `manifest.webmanifest`, `icons/*`.
4. Redeploy in Vercel, then open `/api/ping` and check that `pushKeysSet` and `cronSecretSet` are true.
5. On the iPhone: Safari > Share > Add to Home Screen > open Healthy Plate from the new icon > person icon > Notifications > Turn on > Send a test.
6. If nothing arrives: check Settings > Notifications > Healthy Plate, Focus mode, and Low Power Mode.

## Update: Dashboard and complete health checklist (step 1 of 3)

### What is new
- **Home tab (Dashboard)** is now the first page and the page you land on after logging in.
  - *Upcoming events*: five expandable cards (Grocery Purchase, Medicine Purchase, Meal Preparation, Exercises, Health Check-ups). Each shows the next activity and expands to the details. They read from your existing groceries, stock, meals, exercise, medicines and test results.
  - *Calorie Statistics*: calories burned, intake, net, remaining against your daily target, and a recommendation worked out from your real numbers.
  - *Physical Statistics*: current weight and BMI, target weight and BMI, weight progress, and a line graph of your history with your target line (1M / 3M / 6M / 1Y / All, Weight or BMI).
  - *Health Check Statistics*: tap the card for a large pop-up with four boxes (blood and urine, heart, eye, lung). Each box has its own dropdown and graph, reference range, out-of-range points in red, and the latest and previous result. Tests such as ECG, echo, X-ray and retinal exam show a dated timeline instead of a graph.
  - *Medicine Statistics*: active medicines with purpose, dosage, frequency, timing and status, plus a button for the complete list.
- **Health tab** now holds the full 24-test checklist in four groups (frequency and "preferred for" shown for each). One list is used everywhere (`shared/tests.js`). New results are always added, so your history is never overwritten. You can correct a result, and two results for the same test on the same date are blocked.
- **Medicines** can now have a purpose, frequency, timing and a "supply lasts until" date. You can stop a medicine (it moves to Discontinued and keeps its history) and resume it later.
- **Profile** has new Target weight and Target BMI fields. Enter either one and the other is worked out from your height.
- Older lab entries from the first version are moved into the new checklist automatically. Anything that does not fit a checklist test stays visible under "Older entries".

### Things to know
- **Calories eaten:** your meal chart has no calorie numbers and none are invented. On the Home tab tap *Set meal calories* and enter the calories for each meal (from your dietitian's chart). Meals you mark as prepared on the Meals tab then count as eaten.
- **Calories burned:** estimated from the activity, your minutes and your weight using standard MET values (Walking 3.5, Yoga 2.5, Cycling 6, Strength 4, Other 4). If you type the calories for an activity (for example from a watch), your number is used instead. Without a weight or typed calories, the card shows a dash instead of guessing.
- **BMI graph** shows the standard adult range 18.5 to 24.9. Reference ranges for tests are general adult values for orientation only. Your doctor's targets may differ.
- On a phone the Health Check pop-up fills about 90% of the screen height so the graphs stay readable. On a laptop it is 75% of the screen.
- Nothing from this update needs new settings in Vercel.

### How to put this update online
1. Unzip the file. On GitHub open your `healthy-plate` repository and choose **Add file > Upload files**.
2. Drag in everything inside the unzipped folder, including the **`js`** and **`shared`** folders. Files with the same name are replaced and your data is not touched.
3. Click **Commit changes**. Vercel redeploys by itself in about a minute.
4. Open your app, pull down to refresh (on iPhone close and reopen it), and log in. You land on the Dashboard.

Steps 2 and 3 (push notifications and reminders) come next. The folder already contains some files for them (`api/push.js`, `api/reminders.js`, `api/cron.js`, `sw.js`, icons). They do nothing until those steps are finished and are not part of this update.

---

## Original setup guide (GitHub + Vercel + MongoDB)

You do not need to know anything about backends. Follow the steps in order. Total time: about 20 minutes.

## What you are building

```
Phone / laptop browser
        |
        v
  index.html  (the app, hosted by Vercel, code stored on GitHub)
        |  calls /api/...
        v
  api/ folder (small "serverless functions" on Vercel: login + save/load)
        |
        v
  MongoDB database (stores your data safely in the cloud)
```

- **GitHub** keeps your code. Every time you change a file there, Vercel updates the live app by itself.
- **Vercel** runs the app and the `api/` functions. You never manage a server.
- **MongoDB** (added from inside Vercel) is the database.

The app still works instantly from the phone's own storage, and saves every change to the database in the background. If the internet drops, changes wait on the device and upload later.

## What is in this folder

| File / folder | What it does |
|---|---|
| `index.html` | The whole app (your original plus login, profile, health tests, price list, cloud sync) |
| `api/auth.js` | Create account and log in |
| `api/sync.js` | Save and load your data |
| `api/ping.js` | A setup checker you can open in the browser |
| `lib/` | Helper code used by the api files (database connection, password safety) |
| `package.json` | Tells Vercel to install the MongoDB driver |
| `vercel.json` | Small security headers |
| `.env.example` | List of settings you will add in Vercel (not used directly) |

## What is stored in the database

Each person logs in with their own username, and sees only their own data.

| MongoDB collection | Contains |
|---|---|
| `users` | Username, name, scrambled (hashed) password |
| `profiles` | User details: name, age, sex, height, weight, calorie target, doctor, dietitian, conditions, notes |
| `settings` | Language, theme, family size and portions, daily exercise goal |
| `prices` | Your price list and price comparisons |
| `medications` | Medication list (name, dose, time of day) |
| `health_tests` | Test results: HbA1c, glucose, TSH, cholesterol, blood pressure, weight and others, with date and note |
| `exercise_logs` | One entry per day: exercise minutes and which medicines were taken |
| `kitchen` | Pantry stock, meals marked as prepared, shopping ticks |

---

## Step 1. Put the code on GitHub

1. Go to <https://github.com> and sign up (free) or log in.
2. Click the **+** at the top right, then **New repository**.
3. Name it `healthy-plate`. Choose **Private** (recommended, your health app should not be public). Click **Create repository**.
4. On the next page click the link **uploading an existing file**.
5. On your computer, open this unzipped folder. Select **everything inside it** (`index.html`, `api`, `lib`, `package.json`, `vercel.json`, `.gitignore`, `.env.example`, `README.md`) and drag it into the GitHub page.
   - Upload the *contents*, not the outer folder. `index.html` and the `api` folder must sit at the top level of the repository.
   - Hidden files such as `.gitignore` may not show in your file manager. They are optional, so skip them if you cannot see them.
6. Wait for the upload bar to finish, then click **Commit changes**.
7. Check the repository page: you should see `api`, `lib` and `index.html` listed.

## Step 2. Deploy on Vercel

1. Go to <https://vercel.com/signup> and choose **Continue with GitHub**. Allow access.
2. Click **Add New... > Project**.
3. Find `healthy-plate` in the list and click **Import**. If it is missing, click **Adjust GitHub App Permissions** and give Vercel access to that repository.
4. Leave every setting as it is (Framework Preset: **Other**, no build command). Click **Deploy**.
5. After about a minute you get a website address like `healthy-plate-abc.vercel.app`. The app will open, but login will not work yet because there is no database.

## Step 3. Add the MongoDB database

Vercel has MongoDB Atlas built in, so you do not need a separate MongoDB account.

1. In Vercel, open your `healthy-plate` project and click the **Storage** tab.
2. Choose **MongoDB Atlas** (under Marketplace / native integrations) and click **Install**.
3. Accept the terms, choose the **Free** plan and the **Free** cluster (512 MB, no credit card). Pick a region close to you (Mumbai if offered).
4. Accept the generated database name and click **Create MongoDB Atlas Cluster**. Wait until the status says **Available**.
5. Make sure it is **connected to your `healthy-plate` project** and to all environments (Production, Preview, Development).
6. Go to the project's **Settings > Environment Variables**. You should now see `MONGODB_URI` there. Vercel added it for you.

Atlas needs to accept connections from Vercel, whose addresses change. The integration normally adds this rule for you (it appears as `0.0.0.0/0` in the Atlas "Network Access" list). Atlas may email you a notice about it. That is expected.

## Step 4. Add your secret key (the one setting you add yourself)

The app signs login tokens with a secret that only your server knows.

1. Make a long random text of 40 or more characters. Easy way: open any web page, press **F12**, click **Console**, paste this and press Enter, then copy the result (without quotes):
   ```
   crypto.randomUUID() + crypto.randomUUID()
   ```
2. In Vercel go to **Settings > Environment Variables** and add:
   - Name: `AUTH_SECRET`
   - Value: the text you copied
   - Environments: all three
   - Click **Save**.
3. Recommended, also add `REGISTRATION_CODE` with a word or number only your family knows (for example `kerala2026plate`). People then need this "invite code" to create an account, so strangers who find your link cannot sign up.
   - Later, once everyone has an account, you can add `ALLOW_REGISTRATION` = `false` to close sign-ups completely.
4. Keep the secret private. Do not put it in GitHub, WhatsApp or screenshots.

## Step 5. Redeploy so the new settings take effect

Settings only apply to new deployments.

1. Click the **Deployments** tab.
2. On the latest deployment click the **...** menu, then **Redeploy**, then confirm.
3. Wait for **Ready**.

## Step 6. Check that it works

1. Open `https://YOUR-APP.vercel.app/api/ping` in a browser. You want to see:
   ```
   {"ok":true,"mongoUriSet":true,"authSecretSet":true,"dbConnected":true, ...}
   ```
   If something is `false`, see Troubleshooting below.
2. Open `https://YOUR-APP.vercel.app`. Click **Create account**, enter name, username, password (8+ characters) and the invite code if you set one.
3. Tap the person icon at the top right and fill in your profile, then **Save**. The small dot on that icon turns green when everything is saved to the cloud.
4. Try the **Health** tab: add a test result (for example HbA1c 6.8) and a medicine.
5. Proof that it is in the database: open the app in a different browser (or your phone), log in with the same username and password. Your profile, medicines and results appear.

You can also look at the raw data: in Vercel open **Storage**, open your MongoDB database, and use **Open in MongoDB Atlas > Browse Collections**.

## Step 7. Add it to your phone's home screen

- **Android (Chrome):** menu (three dots) > **Add to Home screen**.
- **iPhone (Safari):** Share button > **Add to Home Screen**.

## Changing the app later

1. In GitHub open the file (for example `index.html`), click the pencil icon, edit, then **Commit changes**.
2. Vercel redeploys automatically within a minute. Your data in MongoDB is not touched.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| `/api/ping` shows `mongoUriSet: false` | The database is not connected to the project. Repeat Step 3, point 5, then redeploy. |
| `authSecretSet: false` | Add `AUTH_SECRET` (Step 4) with 16+ characters and redeploy. |
| `dbConnected: false` but `mongoUriSet: true` | In MongoDB Atlas > Network Access, make sure `0.0.0.0/0` is allowed. Redeploy. |
| "Server setup incomplete" on the login screen | Same as the two rows above. |
| `/api/ping` shows the code of the file or a 404 | `api` folder is not at the top level of the repository. Re-upload so `api/ping.js` exists at the root. |
| "Invite code is missing or wrong" | Type exactly the `REGISTRATION_CODE` you set. |
| "Too many wrong attempts" | Wait 15 minutes. The app locks an account for 15 minutes after 5 wrong passwords. |
| Forgot password | There is no email reset in this version. Delete the user from the `users` collection in Atlas (Browse Collections) and register again, or ask Claude to add a reset flow. |
| Dot on the account icon is red | The phone is offline or the server is down. Changes stay on the device and upload by themselves later. |

## Good to know

- **Health data is sensitive.** Passwords are stored hashed (never readable), logins use signed tokens, and the data travels over HTTPS. Still, keep the repository private, use a strong invite code, and do not share the secret.
- **Free limits:** the free MongoDB cluster holds 512 MB, far more than this app needs. Vercel's free Hobby plan is for personal, non-commercial use.
- **Live price refresh** in your original app used a tool that only exists inside Claude. On your own website it quietly falls back to saved prices. Use the **Price list (₹)** panel at the bottom of the **Stock** tab to keep prices up to date; they are saved to the database.
- **Backups:** Atlas free clusters have no automatic backups. If you want a copy of your data, use **Browse Collections > Export** in Atlas from time to time.
- **Logging out** removes the saved data from that device (after uploading it). Log in again to bring it back.
- **Two devices at once:** the most recently changed item wins. Changes sync when you open the app and a few seconds after each edit.
