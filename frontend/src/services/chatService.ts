// src/services/chatService.ts
import { IPublicClientApplication } from "@azure/msal-browser";
import * as signalR from "@microsoft/signalr";
import { apiRequest, API_BASE_URL } from "../authConfig";

export interface ChatMessage {
  id:          string;
  roomId:      string;
  senderEmail: string;
  senderName:  string;
  body:        string;
  isBot:       boolean;
  sentAt:      string;
}

export interface ChatRoom {
  id:          string;
  roomType:    "direct" | "bot";
  otherName:   string;
  otherEmail:  string;
  lastMessage: string;
  lastAt:      string;
}

export interface Employee {
  id:          number;
  email:       string;
  displayName: string;
  department:  string | null;
  jobTitle:    string | null;
  role:        string;
  initials:    string;
}

// ── Token helper ─────────────────────────────────────────────────────────────
async function getToken(instance: IPublicClientApplication): Promise<string> {
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!account) throw new Error("Not signed in.");
  const result = await instance.acquireTokenSilent({ ...apiRequest, account });
  return result.accessToken;
}

// ── REST helpers ─────────────────────────────────────────────────────────────
async function get<T>(path: string, instance: IPublicClientApplication): Promise<T> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}

async function post<T>(path: string, body: unknown, instance: IPublicClientApplication): Promise<T> {
  const token = await getToken(instance);
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}

export const fetchEmployees = (instance: IPublicClientApplication) =>
  get<Employee[]>("/api/chat/employees", instance);

export const fetchRooms = (instance: IPublicClientApplication) =>
  get<ChatRoom[]>("/api/chat/rooms", instance);

export const fetchMessages = (roomId: string, instance: IPublicClientApplication) =>
  get<ChatMessage[]>(`/api/chat/rooms/${roomId}/messages`, instance);

export const getOrCreateDirect = (targetEmail: string, instance: IPublicClientApplication) =>
  post<{ roomId: string }>("/api/chat/rooms/direct", { targetEmail }, instance);

export const getOrCreateBotRoom = (instance: IPublicClientApplication) =>
  post<{ roomId: string }>("/api/chat/rooms/bot", {}, instance);

// ── SignalR connection ────────────────────────────────────────────────────────
let _connection: signalR.HubConnection | null = null;
let _tokenFn: (() => Promise<string>) | null = null;

export function initChatConnection(instance: IPublicClientApplication) {
  _tokenFn = () => getToken(instance);

  _connection = new signalR.HubConnectionBuilder()
    .withUrl(`${API_BASE_URL}/hubs/chat`, {
      accessTokenFactory: _tokenFn,
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  return _connection;
}

export function getConnection() {
  return _connection;
}

export async function startConnection() {
  if (!_connection) throw new Error("Call initChatConnection first.");
  if (_connection.state === signalR.HubConnectionState.Disconnected)
    await _connection.start();
}

export async function stopConnection() {
  if (_connection?.state !== signalR.HubConnectionState.Disconnected)
    await _connection?.stop();
}

export async function sendMessage(roomId: string, body: string) {
  if (!_connection) throw new Error("Not connected.");
  if (_connection.state !== signalR.HubConnectionState.Connected)
    throw new Error("Chat disconnected. Please wait for reconnection.");
  await _connection.invoke("SendMessage", roomId, body);
}

export async function sendTyping(roomId: string, isTyping: boolean) {
  // Only send if connected — never throw on transient failures
  if (_connection?.state !== signalR.HubConnectionState.Connected) return;
  try {
    await _connection.invoke("MarkTyping", roomId, isTyping);
  } catch { /* ignore typing errors — not critical */ }
}

export async function joinRoom(roomId: string) {
  if (_connection?.state !== signalR.HubConnectionState.Connected) return;
  try { await _connection.invoke("JoinRoom", roomId); } catch {}
}

export async function leaveRoom(roomId: string) {
  if (_connection?.state !== signalR.HubConnectionState.Connected) return;
  try { await _connection.invoke("LeaveRoom", roomId); } catch {}
}