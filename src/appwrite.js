import { Client, Databases, Account, Query, ID } from "appwrite";

const client = new Client().setEndpoint("https://sgp.cloud.appwrite.io/v1").setProject("69aa2248001ede62df80");

export const databases = new Databases(client);
export const account = new Account(client);
export { client, Query, ID };

export const DATABASE_ID = "69aa22dc003e3e411118";
export const ROOMS_COLLECTION = "rooms";
export const MOVES_COLLECTION = "moves";

export const ROUND_COUNTDOWN_SECS = 10;
export const EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };
export const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
export const LOSES_TO = { rock: "scissors", paper: "rock", scissors: "paper" };
