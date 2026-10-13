# Run and host Senda without Copilot

Senda is a normal Expo/React Native project. Copilot is not required to install, run, test, or host it.

## 1. Run it on your Windows computer

Install the current Node.js LTS release from https://nodejs.org/ and Git from https://git-scm.com/download/win.

Open PowerShell and run:

```powershell
git clone https://github.com/nashe66-create/senda3.0.git
cd senda3.0
npm install
Copy-Item .env.example .env
```

Open `.env` in a text editor. Set the Supabase values from the Supabase Dashboard → Project Settings / Connect. Use the project URL and a **publishable key** (or the legacy anon key). Never use a `service_role` or secret key in this file.

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Then start Expo:

- Browser: `npx expo start --web`
- Phone with Expo Go: `npm run dev`
- Phone and computer on the same network: `npm run dev:local`

If the browser command reports missing web dependencies, run `npx expo install react-dom react-native-web` and commit the resulting package/lockfile changes.

## 2. Keep a permanent browser prototype

The local Expo server is for development only. To get a stable URL that works while your computer is off, deploy the web build to a static host.

One straightforward option is Cloudflare Pages:

1. Sign in to Cloudflare and open **Workers & Pages → Create → Pages → Connect to Git**.
2. Connect GitHub and select `nashe66-create/senda3.0`.
3. Use these build settings:
   - Framework preset: **None**
   - Build command: `npm run build:web`
   - Build output directory: `dist`
   - Root directory: repository root
4. Add these build environment variables in the Pages project settings:
   - `EXPO_PUBLIC_SUPABASE_URL` = your Supabase project URL
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = your Supabase publishable key
5. Deploy. Cloudflare gives you a permanent `pages.dev` URL. Each push to the configured production branch can trigger a fresh deployment.

Expo's `web.output` is already configured as `single`, which is appropriate for a single-page web app. If you later change the Expo web output mode or add server-only routes, review the hosting configuration before deploying.

## 3. Confirm the prototype is really connected

After the hosted build loads:

- Sign in and sign out, if authentication is enabled for the current build.
- Confirm the app can read and write only the signed-in user's permitted data.
- Test quotes and payment initiation with provider sandbox credentials only.
- Check the browser console and Supabase Edge Function logs for errors.
- Confirm Row Level Security (RLS) is enabled and correctly scoped for every exposed table.

A page that loads is not proof that the payment flow works. Do not use live customer money until the provider setup, regulatory responsibilities, authentication, and end-to-end payment/payout states have been verified.

## 4. Important key handling

The `EXPO_PUBLIC_*` values are bundled into the client and must be treated as public. RLS and server-side authorization protect the data. Never place Supabase service-role/secret keys, Flutterwave secret keys, cron secrets, or other privileged credentials in `.env`, Expo public variables, or browser code.
