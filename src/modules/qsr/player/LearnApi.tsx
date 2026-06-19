// The lesson player talks to the backend through these five calls. By default
// they're the authenticated learner endpoints; the public QR player swaps in
// token-bound versions via the provider, so the exact same card renderers work
// for a signed-in user and an anonymous crew member who scanned a store code.
import { createContext, useContext } from "react";
import { fetchLesson, recordCardProgress, answerQuiz, votePoll, completeLesson } from "../api";

export interface LearnApi {
  fetchLesson: typeof fetchLesson;
  recordCardProgress: typeof recordCardProgress;
  answerQuiz: typeof answerQuiz;
  votePoll: typeof votePoll;
  completeLesson: typeof completeLesson;
}

const authedApi: LearnApi = { fetchLesson, recordCardProgress, answerQuiz, votePoll, completeLesson };
const LearnApiContext = createContext<LearnApi>(authedApi);

export const LearnApiProvider = LearnApiContext.Provider;
export function useLearnApi(): LearnApi {
  return useContext(LearnApiContext);
}
