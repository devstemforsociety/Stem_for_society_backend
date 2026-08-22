import { debugLog } from "../../utils/logger";
import { Request, RequestHandler, Response } from "express";
import { db } from "../../db/connection";
import { z } from "zod";
import { createBlogSchema } from "./validation";
import { createValidationError} from "../../utils/validation";
import { blogAuthorTable, blogTable } from "../../db/schema";
import { nanoid } from "nanoid";
import { supabase, SUPABASE_PROJECT_URL } from "../../supabase";
import { INVALID_SESSION_MSG } from "../../utils/constants";
import { eq, sql } from "drizzle-orm";

export const getBlogs: RequestHandler = async (req: Request, res: Response) => {
  try {
    const adminAuth = req.auth?.["ADMIN"];
    const blogs = await db.query.blogTable.findMany({
      with: {
        blogAuthor: {
          columns: {
            name: true,
          },
        },
      },
      columns: {
        category: true,
        coverImage: true,
        createdAt: true,
        title: true,
        id: true,
        slug: true,
        references: true,
        approvedBy: adminAuth ? true : false,
        // Lets the moderation queue tell "rejected" from "not looked at yet".
        rejectedAt: adminAuth ? true : false,
      },
      where(fields, operators) {
        return adminAuth ? sql`true` : operators.isNotNull(fields.approvedBy);
      },
    });
    res.json({ data: blogs });
  } catch (error) {
    debugLog("🚀 ~ getBlogs ~ error:", error);
    res.status(500).json({
      error: "Server error in fetching blogs",
    });
  }
};

export const getBlog: RequestHandler = async (req: Request, res: Response) => {
  try {
    const adminAuth = req.auth?.["ADMIN"];
    const { blogSlug: blogSlugUnsafe } = req.params;
    const blogSlug = z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9-_]*$/, "Invalid blog link")
      .safeParse(blogSlugUnsafe);
    if (!blogSlug.success) {
      res.status(400).json({
        error: "Invalid blog ID",
      });
      return;
    }
    const blog = await db.query.blogTable.findFirst({
      with: {
        blogAuthor: {
          columns: {
            name: true,
            designation: true,
            linkedin: true,
            /**
             * Contact details are for moderators, not readers. This route is
             * public (requireAuthToken("ADMIN", false)), so every published
             * article was handing out the author's personal email address and
             * phone number to anyone who loaded the page.
             */
            email: adminAuth ? true : false,
            mobile: adminAuth ? true : false,
          },
        },
      },
      where(fields, operators) {
        return operators.and(
          operators.eq(fields.slug, blogSlug.data),
          adminAuth ? sql`true` : operators.isNotNull(fields.approvedBy),
        );
      },
    });
    if (!blog) {
      res.status(404).json({
        error:
          "No such blog is found! It is either deleted or your URL is invalid!",
      });
      return;
    }
    res.json({ data: blog });
  } catch (error) {
    debugLog("🚀 ~ getBlogs ~ error:", error);
    res.status(500).json({
      error: "Server error in fetching blog",
    });
  }
};

export const createBlog: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const rawData = req.body;

    // Without this the next line dereferences req.file and throws, which the
    // catch below reported as a server error - so an author who forgot a cover
    // image (or whose upload was rejected) lost the whole article to a 500.
    if (!req.file) {
      res.status(400).json({
        error: "A cover image is required to publish an article.",
      });
      return;
    }

    let references: unknown;
    try {
      references = JSON.parse(rawData.references ?? "[]");
    } catch {
      res.status(400).json({ error: "References are not in a readable format." });
      return;
    }

    const blogEntry = createBlogSchema.safeParse({
      ...rawData,
      coverImage: new File([new Uint8Array(req.file.buffer)], req.file.filename, {
        type: req.file.mimetype,
      }),
      references,
      category: rawData.category, // Add category parsing
    });
    
    if (!blogEntry.success) {
      res.status(400).json({
        errors: createValidationError(blogEntry),
      });
      return;
    }

    const generateSlug = (title: string) => {
      const base = title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');

      const unique = Math.random().toString(36).substring(2, 10);
      return `${base}-${unique}`;
    };

    let blogCoverImageURL;
    const blogSlug = generateSlug(blogEntry.data.title);
    const { data, error } = await supabase.storage
      .from("s4s-media")
      .upload(
        "public/photos/" + blogSlug + ".jpg",
        blogEntry.data.coverImage,
        { upsert: true },
      );
    if (error) {
      res.status(500).json({
        error: "Something went wrong when uploading cover image",
      });
      return;
    }
    blogCoverImageURL =
      SUPABASE_PROJECT_URL + "/storage/v1/object/public/" + data.fullPath;

    await db.transaction(async (tx) => {
      let [existingBlogAuthor] = await tx
        .select()
        .from(blogAuthorTable)
        .where(eq(blogAuthorTable.email, blogEntry.data.authorEmail));
      if (!existingBlogAuthor) {
        [existingBlogAuthor] = await tx
          .insert(blogAuthorTable)
          .values({
            name: blogEntry.data.authorName,
            email: blogEntry.data.authorEmail,
            mobile: blogEntry.data.authorMobile,
            designation: blogEntry.data.authorDesignation,
            linkedin: blogEntry.data.authorLinkedin,
          })
          .returning();
      }

      await tx.insert(blogTable).values({
        content: blogEntry.data.content,
        slug: blogSlug,
        title: blogEntry.data.title,
        author: existingBlogAuthor.id,
        coverImage: blogCoverImageURL,
        references: blogEntry.data.references,
        category: blogEntry.data.category, // Add category to database insert
      });
    });
    
    res.json({
      message: "Blog created successfully",
    });
  } catch (error) {
    debugLog("🚀 ~ createBlog ~ error:", error);
    res.status(500).json({
      error: "Server error in creating blog",
    });
  }
};

export const approveBlog: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const adminAuth = req.auth["ADMIN"];
    if (!adminAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }
    const { blogSlug: blogSlugUnsafe } = req.params;
    const blogSlug = z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9-_]*$/, "Invalid blog link")
      .safeParse(blogSlugUnsafe);
    if (!blogSlug.success) {
      res.status(400).json({
        error: "Invalid blog ID",
      });
      return;
    }
    const intent = req.body;
    const intentParsed = z
      .object({ intent: z.literal("approve").or(z.literal("reject")) })
      .safeParse(intent);
    if (!intentParsed.success) {
      res.status(400).json({
        error: "Invalid intent",
      });
      return;
    }
    /**
     * Approval and rejection are now distinct states.
     *
     * Rejecting used to set approvedBy back to null, which is exactly what an
     * unreviewed submission looks like - so a rejected article dropped straight
     * back into the pending queue and was reviewed again on every pass, with no
     * record that anyone had already turned it down. Approving clears any
     * previous rejection so a resubmission can still be accepted.
     */
    const isApproval = intentParsed.data.intent === "approve";
    await db
      .update(blogTable)
      .set(
        isApproval
          ? { approvedBy: adminAuth.id, rejectedAt: null, rejectedBy: null }
          : { approvedBy: null, rejectedAt: new Date(), rejectedBy: adminAuth.id },
      )
      .where(eq(blogTable.slug, blogSlug.data));
    res.json({
      message: `Blog ${intentParsed.data.intent === "approve" ? "approval" : "rejection"} successful!`,
    });
  } catch (error) {
    debugLog("🚀 ~ approveBlog ~ error:", error);
    res.status(500).json({
      error: "Server error in approving blog",
    });
  }
};
