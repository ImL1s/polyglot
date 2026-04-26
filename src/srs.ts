import { fsrs, generatorParameters, createEmptyCard, Rating, State, type Card } from "ts-fsrs";
import { getDb, type ReviewRow } from "./db.ts";

const SCHEDULER = fsrs(generatorParameters({ maximum_interval: 365 * 5 }));

export function ratingFromInt(r: number): Rating {
  switch (r) {
    case 1: return Rating.Again;
    case 2: return Rating.Hard;
    case 3: return Rating.Good;
    case 4: return Rating.Easy;
    default: throw new Error(`Invalid rating ${r}, expected 1-4`);
  }
}

function rowToCard(r: ReviewRow): Card {
  return {
    due: new Date(r.due_at),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state as State,
    last_review: r.last_review ? new Date(r.last_review) : undefined,
    learning_steps: 0,
  };
}

function cardToRowFields(c: Card) {
  return {
    due_at: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

export function getOrInitCard(conceptId: string): Card {
  const db = getDb();
  const row = db.query("SELECT * FROM reviews WHERE concept_id = ?").get(conceptId) as ReviewRow | null;
  if (row) return rowToCard(row);

  const card = createEmptyCard(new Date());
  const f = cardToRowFields(card);
  db.run(
    `INSERT INTO reviews (concept_id, due_at, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [conceptId, f.due_at, f.stability, f.difficulty, f.elapsed_days, f.scheduled_days, f.reps, f.lapses, f.state, f.last_review],
  );
  return card;
}

export interface AnswerInput {
  conceptId: string;
  rating: number;          // 1-4
  userAnswer?: string;
  llmFeedback?: string;
  source?: string;
  now?: Date;
}

export function recordAnswer(input: AnswerInput): { card: Card; nextDueAt: number } {
  const db = getDb();
  const now = input.now ?? new Date();
  const card = getOrInitCard(input.conceptId);
  const ratingEnum = ratingFromInt(input.rating);
  const result = SCHEDULER.next(card, now, ratingEnum);
  const nextCard = result.card;
  const f = cardToRowFields(nextCard);

  db.run(
    `UPDATE reviews
     SET due_at=?, stability=?, difficulty=?, elapsed_days=?, scheduled_days=?,
         reps=?, lapses=?, state=?, last_review=?
     WHERE concept_id=?`,
    [f.due_at, f.stability, f.difficulty, f.elapsed_days, f.scheduled_days, f.reps, f.lapses, f.state, f.last_review, input.conceptId],
  );

  db.run(
    `INSERT INTO attempts (concept_id, rating, user_answer, llm_feedback, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.conceptId, input.rating, input.userAnswer ?? null, input.llmFeedback ?? null, input.source ?? "manual", now.getTime()],
  );

  return { card: nextCard, nextDueAt: f.due_at };
}
