import { Configuration, RedirectRequest } from "@azure/msal-browser";

export const msalConfig: Configuration = {
  auth: {
    clientId: "baae60e4-4909-4301-8c56-e8e853c87f9b",
    authority: "https://login.microsoftonline.com/a265301a-63b1-4aec-9d47-273b49c178b4",
    redirectUri: "http://localhost:5173",
    postLogoutRedirectUri: "http://localhost:5173",
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

export const loginRequest: RedirectRequest = {
  scopes: ["openid", "profile", "email", "User.Read"],
};

export const apiRequest = {
  scopes: ["api://baae60e4-4909-4301-8c56-e8e853c87f9b/access_as_user"],
};

export const API_BASE_URL = "http://localhost:5086";