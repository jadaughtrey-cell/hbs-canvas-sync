export interface CanvasAssignment {
  id: number;
  name: string;
  course_id: number;
  course_name: string;
  course_code: string;           // e.g. "BGIE", "FIN2", "LCA", "DSAIL"
  due_at: string | null;
  description: string | null;    // raw HTML from Canvas
  questions: string[];           // extracted assignment questions
  html_url: string;
}

export interface DateRangeRequest {
  token: string;
  startDate: string;             // YYYY-MM-DD
  endDate: string;               // YYYY-MM-DD
}

// Mapping of Canvas course IDs to short course codes
export const HBS_COURSES: Record<number, string> = {
  16143: "BGIE",
  16192: "FIN2",
  16166: "LCA",
  16156: "DSAIL",
};

// Course accent colors
export const COURSE_COLORS: Record<string, string> = {
  BGIE:  "#1F3864",
  FIN2:  "#1B4F72",
  LCA:   "#1A5C4A",
  DSAIL: "#5B2C6F",
  OTHER: "#555555",
};
