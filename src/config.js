/**
 * Google OAuth client ID for this deployment (public in the browser by design).
 * Change here if you use a different OAuth client.
 */
const GOOGLE_CLIENT_ID =
  "205907748929-ihek5jm5g93b6bugptg3vss6d4rhd2ed.apps.googleusercontent.com";

/** @returns {{ googleClientId: string }} */
export function getConfig() {
  return {
    googleClientId: GOOGLE_CLIENT_ID,
  };
}
