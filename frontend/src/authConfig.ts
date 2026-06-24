// frontend\src\authConfig.ts
import { Configuration, RedirectRequest } from "@azure/msal-browser";

const isProd = import.meta.env.PROD;

export const msalConfig: Configuration = {
  auth: {
    clientId:              "baae60e4-4909-4301-8c56-e8e853c87f9b",
    authority:             "https://login.microsoftonline.com/a265301a-63b1-4aec-9d47-273b49c178b4",
    redirectUri:           isProd ? "https://44.210.115.237" : "http://localhost:5173",
    postLogoutRedirectUri: isProd ? "https://44.210.115.237" : "http://localhost:5173",
  },
  cache: {
    cacheLocation:          "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

export const loginRequest: RedirectRequest = {
  // Request Mail.Send up front at login so the silent acquire later
  // doesn't need a fresh interactive consent prompt.
  scopes: ["openid", "profile", "email", "User.Read", "Mail.Send"],
};

export const apiRequest = {
  scopes: ["api://baae60e4-4909-4301-8c56-e8e853c87f9b/access_as_user"],
};

// Separate token request for Graph mail sending — different audience
// (graph.microsoft.com) than your own API audience above.
export const graphMailRequest: RedirectRequest = {
  scopes: ["Mail.Send"],
};

export const API_BASE_URL = isProd ? "" : "http://localhost:5086";