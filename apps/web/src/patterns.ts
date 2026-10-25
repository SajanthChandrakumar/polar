export type PatternOutcome = 'sleep' | 'ans';
export type PatternGroup = 'lower' | 'upper';
export type PatternQuartiles = { count: number; median: number | null; q1: number | null; q3: number | null };
export type PatternPair = {
  activity_date: string;
  outcome_date: string;
  steps: number;
  value: number;
  group: PatternGroup;
  activity_response_ids: string[];
  outcome_response_ids: string[];
};
export type PatternAnalysis = {
  days: number;
  outcome: PatternOutcome;
  from: string;
  to: string;
  activity_from: string;
  activity_to: string;
  timezone: 'Europe/Zurich';
  unit: 'min' | 'ANS';
  threshold: number | null;
  status: 'available' | 'insufficient';
  minimum_group_size: 7;
  groups: { lower: PatternQuartiles; upper: PatternQuartiles };
  pairs: PatternPair[];
  exclusions: { activity_unavailable: number; activity_provisional: number; outcome_unavailable: number };
};

export const PATTERN_ACTIVITY_SOURCE = '/activity/list';
export const PATTERN_SLEEP_SOURCE = '/sleeps';
export const PATTERN_ANS_SOURCE = '/nightly-recharge-results';
