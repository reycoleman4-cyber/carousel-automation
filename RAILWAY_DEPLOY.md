# Deploy latest code to Railway

Follow these steps so https://sound-surge-production.up.railway.app/ gets your latest changes (auth fix, signup tab, etc.).

## 1. Deploy from the project root

Open a terminal and run these commands **from this project folder** (where `server.js` and `public/` live):

```bash
cd "/Users/reycoleman/Downloads/Carousel Automation Cursor Project"
npx @railway/cli up
```

If the CLI asks you to link a project, choose your **Sound Surge / Carousel Automation** project. The upload includes your latest `public/app.js`, `public/index.html`, `server.js`, etc., and triggers a new deploy.

## 2. Set environment variables on Railway

Your `.env` file is **not** deployed (it’s in `.gitignore`). So the app on Railway must get Supabase keys from **Railway’s environment variables**:

1. Go to [Railway Dashboard](https://railway.app/dashboard) and open your **Sound Surge** (or Carousel Automation) project.
2. Open the **service** that runs this app.
3. Go to the **Variables** tab.
4. Add (or update) these variables with the **same values** as in your local `.env`:
   - `SUPABASE_URL` = `https://yyrhaeuntkwzsmmyekcq.supabase.co`
   - `SUPABASE_ANON_KEY` = your anon public key (the long JWT from Supabase → Project Settings → API → anon public)
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key (from the same API page)

If any of these are missing or wrong, you’ll see “Invalid API key” or “Invalid Compact JWS” on the live site.

5. Save. Railway will redeploy when you change variables (or you can trigger a redeploy from the Deployments tab).

## 3. Confirm the new build

After the deploy finishes:

1. Open https://sound-surge-production.up.railway.app/
2. Do a **hard refresh**: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows), or use an incognito window.
3. Check that:
   - **Sign up** tab switches to the signup form.
   - **Log in** works and sends you to the home page.

If it still looks old, wait 1–2 minutes for the new deployment to be live, then hard refresh again.
