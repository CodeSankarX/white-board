# Gcalidraw

Static whiteboard that saves `.excalidraw` files to **your** Google Drive (folder **Excalidraw Drive** at Drive root). No backend: [Vite](https://vitejs.dev/) + React + [`@excalidraw/excalidraw`](https://www.npmjs.com/package/@excalidraw/excalidraw) + [Google Identity Services](https://developers.google.com/identity/gsi/web) + [Drive API v3](https://developers.google.com/drive/api/guides/about-sdk).

## Prerequisites

- **Node.js 24+** (this repo includes [`.nvmrc`](.nvmrc) with `24`).
- A [Google Cloud project](https://console.cloud.google.com/) with **Google Drive API** enabled.

## Node version (nvm)

```bash
nvm use
# or explicitly:
nvm use 24
```

Install dependencies:

```bash
npm install
```

## Google Cloud setup

1. In APIs & Services → **Library**, enable **Google Drive API**.
2. **Credentials** → Create **OAuth client ID** → type **Web application**.
   - **Authorized JavaScript origins**: e.g. `http://localhost:5173` and `https://YOURNAME.github.io`.
   - Use **only the Client ID** in the browser, never the client secret.
3. (Optional) **API key** for `gapi` — restrict by HTTP referrer and Drive API. The app runs **without** an API key (OAuth-only); set `GOOGLE_API_KEY` in [`src/config.js`](src/config.js) if you add one.
4. OAuth consent screen: add scope `.../auth/drive.file`.

The OAuth **client ID** for this repo is set in [`src/config.js`](src/config.js). Change it there for another project or fork.

## Local development

```bash
npm run dev
```

Open the printed URL, sign in, and allow Drive access. The app creates the **Excalidraw Drive** folder if needed, then either opens your most recently modified `.excalidraw` file or creates **Untitled.excalidraw**.

## GitHub Pages

Your site URL for a project repo is `https://YOURNAME.github.io/REPO/`. Add **Authorized JavaScript origins** in Google Cloud (e.g. `https://YOURNAME.github.io` — no path).

### Option A — GitHub Actions (recommended)

1. Repo → **Settings** → **Pages** → **Build and deployment** → **Source**: **GitHub Actions** (not “Deploy from a branch”).
2. Push to `main`: the workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) runs `npm ci`, builds with `VITE_BASE_PATH=/REPO/` (`REPO` = repository name), and deploys the `dist` artifact.

You can also run the workflow manually: **Actions** → **Deploy Pages** → **Run workflow**.

### Option B — `gh-pages` branch from your machine

1. Before `npm run build` or `npm run deploy`, set Vite’s base path:

   ```bash
   export VITE_BASE_PATH=/REPO/
   npm run deploy
   ```

   Use your real repo name with leading and trailing slashes.

2. `npm run deploy` runs `vite build` then publishes `dist` to the `gh-pages` branch. In **Settings** → **Pages** → deploy from branch **`gh-pages`** / **root** (not Actions).

## Features (Phase 1)

- Sign in / sign out; access token in memory and **`sessionStorage`** for this tab (survives refresh until expiry or Sign out).
- Auto-save (30s after edits) and manual **Save**.
- **Open** file manager: list, open, rename, delete (Drive **trash**).
- **New** diagram: prompt for name, new file in **Excalidraw Drive**.

## Scripts

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Vite dev server                      |
| `npm run build`     | Production build to `dist/`          |
| `npm run preview`   | Serve `dist` locally                 |
| `npm run deploy`    | Build + publish to `gh-pages` branch |

## License

MIT (same spirit as Excalidraw). Ensure you comply with [Google API Terms](https://developers.google.com/terms) for your deployment.
