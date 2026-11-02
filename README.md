# Cafe Hopping Journal ☕

My personal log of cafes I've visited: location, speciality, what to try, my favourite dish and an overall rating.

## How it works

- Cafes are stored in Firebase Firestore (project `cafe-hopping-c3483`, collection `cafes`).
- The journal is private. Visitors only see a sign-in screen; Firestore security rules allow reading and writing only for the owner's Google account.
- Photos are resized in the browser (max 900px, JPEG) and saved inside each cafe's Firestore document. Resizing also strips photo metadata such as GPS location.
- **Export backup** downloads a `cafes.json` file. **Import backup** replaces everything in the database with a backup.

## Hosting on GitHub Pages

### 1. Create a GitHub account
1. Go to <https://github.com/signup>.
2. Enter your email, a password and a username. The username becomes part of your site's address, e.g. `shrutidere13` → `https://shrutidere13.github.io`.
3. Verify your email with the code GitHub sends.

### 2. Create the repository
1. Click **+** (top right) → **New repository**.
2. Name it `cafe-hopping`, set it to **Public**, and click **Create repository**.

### 3. Upload the files
Easiest (no command line): on the new repo's page click **uploading an existing file**, drag in `index.html`, `style.css`, `app.js`, `firebase-config.js` and `README.md`, then click **Commit changes**.

Or with git from this folder:

```bash
git init
git add .
git commit -m "Cafe hopping site"
git branch -M main
git remote add origin https://github.com/shrutidere13/cafe-hopping.git
git push -u origin main
```

### 4. Turn on GitHub Pages
1. In the repo go to **Settings → Pages**.
2. Under **Build and deployment**, set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute your site is live at `https://shrutidere13.github.io/cafe-hopping/`.

### 5. Allow sign-in from the live site
In the Firebase console go to **Authentication → Settings → Authorized domains → Add domain** and add `shrutidere13.github.io`. Without this, sign-in only works on localhost.

## Run it locally

```bash
python -m http.server 8123
```

Then open <http://localhost:8123>.
