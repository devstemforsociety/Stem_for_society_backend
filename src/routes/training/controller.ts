import { debugLog } from "../../utils/logger";
import { Request, RequestHandler, Response } from "express";
import { db } from "../../db/connection";
import { newCourseFormSchema, updateCourseFormSchema } from "./validation";
import { createValidationError, slugify } from "../../utils/validation";
import { trainingLessonTable, trainingTable } from "../../db/schema";
import { INVALID_SESSION_MSG } from "../../utils/constants";
import { z } from "zod";
import { supabase, SUPABASE_PROJECT_URL } from "../../supabase";
import { nanoid } from "nanoid";
import { trainingEnrolmentTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import { generateCertificate } from "../../utils/pdf";

// Add this helper function at the top of the file
const formatDateToString = (date: Date | null): string => {
  if (!date) return new Date().toISOString();
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
};

export const getTrainings: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const partnerAuth = req.auth["PARTNER"];
    if (!partnerAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }
    const trainings = await db.query.trainingTable.findMany({
      with: {
        instructor: {
          columns: {
            firstName: true,
            lastName: true,
          },
        },
        enrolments: {
          columns: {
            id: true,
          },
        },
      },
      where(fields, operators) {
        return operators.eq(fields.createdBy, partnerAuth.id);
      },
      orderBy(fields, operators) {
        return operators.desc(fields.updatedAt);
      },
    });
    res.json({ data: trainings });
  } catch (error) {
    debugLog("🚀 ~ getTrainings ~ error:", error);
    res.status(500).json({
      error: "Server error in fetching training details",
    });
  }
};

export const getTraining: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const partnerAuth = req.auth["PARTNER"];
    if (!partnerAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }
    const { trainingId: trainingIdUnsafe } = req.params;
    const trainingId = z.string().uuid().safeParse(trainingIdUnsafe);
    if (!trainingId.success) {
      res.status(400).json({
        error: "Invalid training ID",
      });
      return;
    }

    const training = await db.query.trainingTable.findFirst({
      with: {
        enrolments: {
          columns: {
            id: true,
            paidOn: true,
            certificate: true,
          },
          with: {
            user: {
              columns: {
                firstName: true,
                lastName: true,
                mobile: true,
                email: true,
                id: true,
              },
            },
          },
        },
        lessons: true,
        ratings: {
          columns: {
            feedback: true,
            rating: true,
            userId: true,
          },
        },
      },
      where(fields, operators) {
        return operators.and(
          operators.eq(fields.createdBy, partnerAuth.id),
          operators.eq(fields.id, trainingId.data),
        );
      },
    });
    res.json({ data: training ?? {} });
  } catch (error) {
    debugLog("🚀 ~ getTrainings ~ error:", error);
    res.status(500).json({
      error: "Server error in fetching training details",
    });
  }
};

export const createTraining: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const partnerAuth = req.auth["PARTNER"];
    if (!partnerAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }
    const rawData = req.body;
    
    debugLog("🚀 ~ createTraining ~ rawData:", rawData);

    const courseCreationParsed = newCourseFormSchema.safeParse({
      ...rawData,
      cost: Number(rawData.cost),
      cover:
        !req.file || !req.file.buffer
          ? null
          : new File([new Uint8Array(req.file!.buffer)], req.file!.filename, {
              type: req.file!.mimetype,
            }),
    });
    
    debugLog("🚀 ~ createTraining ~ parsed:", courseCreationParsed);

    if (!courseCreationParsed.success) {
      debugLog("🚀 ~ createTraining ~ errors:", courseCreationParsed.error);
      res.status(400).json({
        errors: createValidationError(courseCreationParsed),
      });
      return;
    }

    const instructor = await db.query.instructorTable.findFirst({
      where(fields, ops) {
        return ops.and(
          ops.eq(fields.id, partnerAuth.id),
          ops.isNotNull(fields.approvedBy),
        );
      },
    });

    if (!instructor) {
      res.status(403).json({
        error: "You have not been approved and cannot create course yet!",
      });
      return;
    }

    const { data } = courseCreationParsed;
    
    let coverImageURL = null;
    if (data.cover) {
      const { data: uploadResult, error } = await supabase.storage
        .from("s4s-media")
        .upload(`public/photos/${slugify(data.title)}.jpg`, data.cover, {
          upsert: true,
        });

      if (error) {
        debugLog("🚀 ~ createTraining ~ supabase upload error:", error);
        res.status(500).json({
          error: "Server error in uploading file!",
        });
        return;
      }
      coverImageURL = SUPABASE_PROJECT_URL + "/storage/v1/object/public/" + uploadResult.fullPath;
    }

    await db.transaction(async (tx) => {
      const [training] = await tx
        .insert(trainingTable)
        .values({
          title: data.title,
          cost: data.cost.toFixed(2),
          createdBy: partnerAuth.id,
          description: data.description,
          endDate: data.endDate,
          startDate: data.startDate,
          location: data.location || null,
          type: data.type,
          link: data.trainingLink || null,
          courseType: data.course_type,
          whoIsItFor: data.whoIsItFor,
          whatYouWillLearn: data.whatYouWillLearn,
          coverImg: coverImageURL,
          category: data.category,
        })
        .returning();

      // if (data.type !== "OFFLINE" && data.lessons && data.lessons.length > 0) {
      //   await tx.insert(trainingLessonTable).values(
      //     data.lessons.map((lesson, index) => {
      //       const currDate = new Date(data.startDate);
      //       currDate.setDate(currDate.getDate() + index);
            
      //       return {
      //         type: lesson.type,
      //         title: lesson.title,
      //         content: lesson.type === "ONLINE" ? lesson.content : undefined,
      //         video: lesson.type === "ONLINE" ? lesson.video : undefined,
      //         location: lesson.type === "OFFLINE" ? lesson.location : undefined,
      //         trainingId: training.id,
      //         lastDate: currDate,
      //       };
      //     }),
      //   );
      // }
    });
    
    res.json({ message: "Course module created successfully!" });
  } catch (error) {
    debugLog("🚀 ~ createTraining ~ error:", error);
    res.status(500).json({
      error: "Server error in creating training course",
    });
  }
};

export const updateTraining: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const partnerAuth = req.auth["PARTNER"];
    if (!partnerAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }

    const { trainingId: trainingIdUnsafe } = req.params;
    const trainingId = z.string().uuid().safeParse(trainingIdUnsafe);
    if (!trainingId.success) {
      res.status(400).json({
        error: "Invalid training ID",
      });
      return;
    }

    const rawData = req.body;
    const updateParsed = updateCourseFormSchema.safeParse({
      ...rawData,
      cost: rawData.cost ? Number(rawData.cost) : undefined,
      cover:
        !req.file || !req.file.buffer
          ? null
          : new File([new Uint8Array(req.file!.buffer)], req.file!.filename, {
              type: req.file!.mimetype,
            }),
    });

    if (!updateParsed.success) {
      res.status(400).json({
        errors: createValidationError(updateParsed),
      });
      return;
    }

    const existingTraining = await db.query.trainingTable.findFirst({
      where(fields, operators) {
        return operators.and(
          operators.eq(fields.createdBy, partnerAuth.id),
          operators.eq(fields.id, trainingId.data),
        );
      },
    });

    if (!existingTraining) {
      res.status(404).json({
        error: "Training not found or you don't have permission to edit it",
      });
      return;
    }

    const { data } = updateParsed;
    let coverImageURL = existingTraining.coverImg;

    if (data.cover) {
      const { data: uploadResult, error } = await supabase.storage
        .from("s4s-media")
        .upload(`public/photos/${slugify(data.title || existingTraining.title)}.jpg`, data.cover, {
          upsert: true,
        });

      if (error) {
        debugLog("🚀 ~ updateTraining ~ supabase upload error:", error);
        res.status(500).json({
          error: "Server error in uploading profile file!",
        });
        return;
      }
      coverImageURL = SUPABASE_PROJECT_URL + "/storage/v1/object/public/" + uploadResult.fullPath;
    }

    await db
      .update(trainingTable)
      .set({
        title: data.title,
        cost: data.cost ? data.cost.toFixed(2) : undefined,
        description: data.description,
        endDate: data.endDate,
        startDate: data.startDate,
        location: data.location,
        type: data.type,
        link: data.trainingLink,
        courseType: data.course_type,
        whoIsItFor: data.whoIsItFor,
        whatYouWillLearn: data.whatYouWillLearn,
        coverImg: coverImageURL,
        category: data.category,
        updatedAt: new Date(),
      })
      .where(eq(trainingTable.id, trainingId.data));

    res.json({ message: "Training updated successfully!" });
  } catch (error) {
    debugLog("🚀 ~ updateTraining ~ error:", error);
    res.status(500).json({
      error: "Server error in updating training",
    });
  }
};

export const deleteTraining: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const partnerAuth = req.auth["PARTNER"];
    if (!partnerAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }

    const { trainingId: trainingIdUnsafe } = req.params;
    const trainingId = z.string().uuid().safeParse(trainingIdUnsafe);
    if (!trainingId.success) {
      res.status(400).json({
        error: "Invalid training ID",
      });
      return;
    }

    const existingTraining = await db.query.trainingTable.findFirst({
      where(fields, operators) {
        return operators.and(
          operators.eq(fields.createdBy, partnerAuth.id),
          operators.eq(fields.id, trainingId.data),
        );
      },
    });

    if (!existingTraining) {
      res.status(404).json({
        error: "Training not found or you don't have permission to delete it",
      });
      return;
    }

    // Check for enrolments
    const enrolments = await db.query.trainingEnrolmentTable.findFirst({
      where(fields, operators) {
        return operators.eq(fields.trainingId, trainingId.data);
      },
    });

    if (enrolments) {
      res.status(400).json({
        error: "Cannot delete training with existing enrolments. Please contact admin for archiving.",
      });
      return;
    }

    await db.delete(trainingTable).where(eq(trainingTable.id, trainingId.data));

    res.json({ message: "Training deleted successfully!" });
  } catch (error) {
    debugLog("🚀 ~ deleteTraining ~ error:", error);
    res.status(500).json({
      error: "Server error in deleting training",
    });
  }
};


export const generateCertificates: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const partnerAuth = req.auth["PARTNER"];
    if (!partnerAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }
    const { trainingId: trainingIdUnsafe } = req.params;
    const trainingId = z.string().uuid().safeParse(trainingIdUnsafe);
    if (!trainingId.success) {
      res.status(400).json({
        error: "Invalid training ID",
      });
      return;
    }
    /**
     * Accepts the original bare array of enrolment ids, or an object that also
     * says what to do about students who have not left feedback yet:
     *   "abort"   - refuse and report them (default, so old callers are safe)
     *   "include" - certify them anyway
     *   "skip"    - certify everyone else
     */
    const idList = z
      .array(z.string().uuid("Invalid IDs"))
      .min(1, "Atleast one enrolment need to be selected");
    const bodyParsed = z
      .union([
        idList.transform((enrolmentIds) => ({
          enrolmentIds,
          missingFeedback: "abort" as const,
        })),
        z.object({
          enrolmentIds: idList,
          missingFeedback: z.enum(["abort", "include", "skip"]).default("abort"),
        }),
      ])
      .safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ errors: createValidationError(bodyParsed) });
      return;
    }
    const enrolmentIdsParsed = { data: bodyParsed.data.enrolmentIds };
    const missingFeedbackMode = bodyParsed.data.missingFeedback;
    
    const trainingEnrolments = await db.query.trainingTable.findFirst({
      columns: {
        id: true,
        title: true,
        cost: true,       // decides whether payment is required
        startDate: true,  // Add these fields
        endDate: true,    // Add these fields
      },
      with: {
        enrolments: {
          columns: {
            id: true,
            paidOn: true,
            completedOn: true,
            certificate: true,
            userId: true,
          },
          with: {
            user: {
              columns: {
                firstName: true,
                lastName: true,
                mobile: true,
                email: true,
              },
            },
          },
          where(fields, operators) {
            return operators.inArray(fields.id, enrolmentIdsParsed.data);
          },
        },
        ratings: {
          columns: {
            feedback: true,
            rating: true,
            userId: true,
            completedOn: true,
          },
        },
        instructor: {
          columns: {
            firstName: true,
            lastName: true,
            logo: true, // Instructor logo URL
            digitalSign: true, // Digital signature URL
          },
        },
      },
      where(fields, operators) {
        return operators.and(
          operators.eq(fields.createdBy, partnerAuth.id),
          operators.eq(fields.id, trainingId.data),
        );
      },
    });
    
    if (!trainingEnrolments || !(trainingEnrolments.enrolments.length > 0)) {
      res.status(404).json({
        error: "Could not find such course or course has no enrolments!",
      });
      return;
    }
    
    const displayName = (enr: (typeof trainingEnrolments.enrolments)[number]) =>
      [enr.user?.firstName, enr.user?.lastName].filter(Boolean).join(" ").trim() ||
      enr.user?.email ||
      "an enrolled student";

    const hasFeedback = (enr: (typeof trainingEnrolments.enrolments)[number]) => {
      const ratingByUser = trainingEnrolments.ratings.find(
        (rat) => rat.userId === enr.userId,
      );
      return Boolean(ratingByUser?.feedback && ratingByUser.rating);
    };

    const summarise = (list: typeof trainingEnrolments.enrolments) => ({
      count: list.length,
      students: list.map((enr) => ({ enrolmentId: enr.id, name: displayName(enr) })),
    });

    /**
     * A paid course must actually be paid for before it is certified. A free
     * course has nothing to settle, and free enrolments never carry a paidOn
     * date, so requiring one there would block every legitimate free
     * certificate.
     */
    const isPaidCourse = Number(trainingEnrolments.cost ?? 0) > 0;
    const selected = trainingEnrolments.enrolments.filter((enr) => !enr.certificate);

    // Unpaid students are never certified, whatever the partner decides about
    // feedback - the money has not arrived.
    const unpaid = isPaidCourse ? selected.filter((enr) => !enr.paidOn) : [];
    const payable = selected.filter((enr) => !unpaid.includes(enr));
    const awaitingFeedback = payable.filter((enr) => !hasFeedback(enr));

    if (awaitingFeedback.length > 0 && missingFeedbackMode === "abort") {
      /**
       * 422, not 403: the partner is permitted, the selection just is not
       * certifiable as-is. The payload is machine-readable so the UI can offer
       * to include or skip these students instead of dead-ending.
       */
      res.status(422).json({
        code: "FEEDBACK_PENDING",
        error: `${awaitingFeedback.length} selected student(s) have not submitted a rating and feedback yet.`,
        pendingFeedback: summarise(awaitingFeedback),
        unpaidSkipped: summarise(unpaid),
      });
      return;
    }

    const certifiable =
      missingFeedbackMode === "include"
        ? payable
        : payable.filter((enr) => hasFeedback(enr));

    if (certifiable.length === 0) {
      res.status(422).json({
        code: "NOTHING_TO_CERTIFY",
        error: unpaid.length
          ? `No certificates could be issued: ${unpaid.length} selected student(s) have not completed payment for this paid course.`
          : "No certificates could be issued for the selected students.",
        unpaidSkipped: summarise(unpaid),
      });
      return;
    }

    // Already filtered above: no existing certificate, paid (when the course
    // costs money) and feedback handled per the partner's choice.
    const enrolmentsToProcess = certifiable;

    if (selected.length === 0) {
      res.status(400).json({
        error: "All selected students already have certificates generated!",
      });
      return;
    }

    console.log(`🚀 Generating ${enrolmentsToProcess.length} certificates directly...`);

    // First, update database to show "generating" status
    await Promise.all(
      enrolmentsToProcess.map(async (enr) => {
        await db
          .update(trainingEnrolmentTable)
          .set({ certificate: "generating" })
          .where(eq(trainingEnrolmentTable.id, enr.id));
      })
    );

    // Generate certificates directly (no Redis)
    const results = await Promise.allSettled(
      enrolmentsToProcess.map(async (enr) => {
        const certificateId = nanoid(30);
        // May be absent: "include" mode certifies students who never rated.
        const ratingByUser = trainingEnrolments.ratings.find(
          (rat) => rat.userId === enr.userId,
        );

        const certificateData = {
          name: enr.user?.firstName + " " + (enr.user?.lastName ?? ""),
          courseName: trainingEnrolments.title,
          completedOn: formatDateToString(
            ratingByUser?.completedOn ??
              enr.completedOn ??
              trainingEnrolments.endDate,
          ), // Convert Date to string
          certificateId,
          enrolmentId: enr.id,
          instructor:
            trainingEnrolments.instructor?.firstName +
            " " +
            (trainingEnrolments.instructor?.lastName ?? ""),
          startDate: formatDateToString(trainingEnrolments.startDate), // Convert Date to string
          endDate: formatDateToString(trainingEnrolments.endDate),     // Convert Date to string
          digitalSignUrl: trainingEnrolments.instructor?.digitalSign || null,
          logo : trainingEnrolments.instructor?.logo || null,
        };
        
        debugLog(`[cert]: generating for enrolment ${enr.id}`);

        // Call your existing generateCertificate function directly
        const success = await generateCertificate(certificateData);
        
        if (!success) {
          // Reset certificate status on failure
          await db
            .update(trainingEnrolmentTable)
            .set({ certificate: null })
            .where(eq(trainingEnrolmentTable.id, enr.id));
          throw new Error(`Failed to generate certificate for ${certificateData.name}`);
        }
        
        return { success: true, name: certificateData.name };
      })
    );

    // Count successes and failures
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    if (failed > 0) {
      console.error(`❌ ${failed} certificates failed to generate`);
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`Failed certificate ${index + 1}:`, result.reason);
        }
      });
    }

    console.log(`✅ Successfully generated ${successful} certificates`);
    
    res.json({
      message: `Successfully generated ${successful} certificates${failed > 0 ? `. ${failed} failed.` : '.'}`,
      successful,
      failed,
    });
    return;
  } catch (error) {
    debugLog("🚀 ~ generateCertificates ~ error:", error);
    res.status(500).json({
      error: "Server error in generating certificates",
    });
  }
};


