import { z } from "zod";

export const studentTrainingFeedbackSchema = z.object({
  rating: z.number().positive().max(5),
  feedback: z.string().min(3).max(200, "Feedback cannot exceed 200 characters"),
});
