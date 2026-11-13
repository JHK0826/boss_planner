import { initializeApp } from "firebase-admin/app";

initializeApp();

export { registerApiKey } from "./callable/registerApiKey";
export { listCharacters } from "./callable/listCharacters";
export { getCharacterInfo } from "./callable/getCharacterInfo";
export { createParty, joinParty, leaveParty, delegateLeader } from "./callable/party";
export { confirmSchedule, requestChange, approveChange } from "./callable/schedule";
export {
  onUnavailableWrite,
  onVoteWrite,
  onClearWrite,
  weeklyOpen,
  monthlyOpen,
  scheduleSweep,
  dailyClearCheck,
  inputDeadlineCheck,
  onScheduleStateChange,
  onSettlementWrite,
  onMessageCreate,
} from "./triggers";
export { registerSettlement, markPaid, confirmReceived } from "./callable/settlement";
