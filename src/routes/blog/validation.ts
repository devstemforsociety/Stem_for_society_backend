import { z } from "zod";

export const createBlogSchema = z.object({
  // Bounds match the columns these land in (blog.title varchar(200),
  // blog_author.name varchar(50)). Without them an over-long value passed
  // validation and then failed at the database as an opaque 500, losing the
  // whole article.
  title: z.string().min(1, "Title is required").max(200, "Title is too long"),
  content: z
    .string()
    .min(1, "Content is required")
    .max(200_000, "Article is too long"),
  coverImage: z
    .instanceof(File, { message: "Image required!" })
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "Cover image size must be less than 5MB",
    })
    .refine((file) => file.type.includes("image/"), {
      message: "Not valid image format",
    }),
  references: z
    .array(z.string().min(1, "Reference DOI number is required").max(300))
    .max(50, "Too many references"),
  authorName: z
    .string({ required_error: "Name is required!" })
    .min(3, "Name is too short")
    .max(50, "Name is too long"),
  authorEmail: z.string().trim().toLowerCase().email("Invalid email"),
  authorMobile: z
    .string({ required_error: "Mobile is required!" })
    .regex(/^[6789]\d{9}$/, "Mobile number is invalid"),
  authorLinkedin: z
    .string()
    .url("Invalid URl")
    .refine(
      (url) =>
        url.startsWith("https://linkedin.") ||
        url.startsWith("https://www.linkedin."),
      {
        message: "Only valid linkedin links are allowed",
      },
    ),
  authorDesignation: z
    .string()
    .min(1, "Valid designation is required")
    .max(50, "Designation is too long")
    .nullish()
    .or(z.literal("")),
  category: z.string().min(1, "Category is required").max(50, "Category is too long"),
});
