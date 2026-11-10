import { initializeApp } from "firebase-admin/app";

initializeApp();

export { registerApiKey } from "./callable/registerApiKey";
export { listCharacters } from "./callable/listCharacters";
export { getCharacterInfo } from "./callable/getCharacterInfo";
