import { debugLog } from "./logger";
import { eq } from "drizzle-orm";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { Color, PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib";
import { db } from "../db/connection";
import { trainingEnrolmentTable } from "../db/schema";
import { supabase, SUPABASE_PROJECT_URL } from "../supabase";
import { slugify } from "./validation";
import fontkit from "@pdf-lib/fontkit";

/**
 * Everything needed to render one certificate.
 *
 * Previously declared in redis.ts alongside the BullMQ queue. Certificates are
 * generated inline by the /generate endpoint - the queue was never used - so
 * the type now lives with the function that consumes it.
 */
export interface PDFGenerationType {
  name: string;
  courseName: string;
  completedOn: string;
  certificateId: string;
  enrolmentId: string;
  instructor: string;
  startDate: string;
  endDate: string;
  logo?: string | null;
  digitalSignUrl?: string | null;
}

/** #RRGGBB -> pdf-lib rgb(), so the palette reads the same as the site's CSS. */
function hexColor(hex: string) {
  const int = parseInt(hex.replace("#", ""), 16);
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}

/**
 * Certificate palette.
 *
 * Every element used to be drawn in flat black over the printed background,
 * so the finished certificate read like a photocopy. These take the accent
 * blue the site already uses (#0389FF) and pair it with a deep navy for the
 * recipient's name, which is the piece people actually look at.
 */
const CERT_NAME_COLOR = hexColor("#0B3B76");
const CERT_ACCENT_COLOR = hexColor("#0389FF");
const CERT_BODY_COLOR = hexColor("#334155");
const CERT_MUTED_COLOR = hexColor("#94A3B8");

export async function generateCertificate(data: PDFGenerationType) {
  try {
    /**
     * The original sample.pdf background is a pure greyscale scan, so every
     * certificate printed black-on-white however the text was coloured.
     * sample-color.pdf is the same artwork mapped onto the brand ramp
     * (paper -> accent blue -> deep navy) by scripts/build-certificate-template.js.
     * Falling back keeps generation working if that asset is ever missing.
     */
    const colourPdfPath = path.join(__dirname, "../assets/sample-color.pdf");
    const pdfPath = existsSync(colourPdfPath)
      ? colourPdfPath
      : path.join(__dirname, "../assets/sample.pdf");
    const existingPdfBytes = readFileSync(pdfPath);

    // Load PDF document and embed font
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    pdfDoc.registerFontkit(fontkit);
    const nameFontBytes = readFileSync(
      path.join(__dirname, "../assets/GoodVibrations Script.ttf"),
    );
    const nameFont = await pdfDoc.embedFont(nameFontBytes);

    const fontBytes = readFileSync(
      path.join(__dirname, "../assets/Madera Regular.otf"),
    );
    const font = await pdfDoc.embedFont(fontBytes);

    const boldFontBytes = readFileSync(
      path.join(__dirname, "../assets/Madera W01 Bold.otf"),
    );
    const boldFont = await pdfDoc.embedFont(boldFontBytes);

    const pages = pdfDoc.getPages();
    const firstPage = pages[0];

    // Add name to the PDF
    let textWidth = nameFont.widthOfTextAtSize(data.name, 40);
    firstPage.drawText(data.name, {
      x: (firstPage.getWidth() - textWidth) / 2,
      y: 350,
      size: 40,
      font: nameFont,
      color: CERT_NAME_COLOR,
    });

    // Calculate course duration
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    const timeDiff = endDate.getTime() - startDate.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
    
    let duration: string;
    if (daysDiff === 1) {
      duration = "one day";
    } else if (daysDiff <= 7) {
      duration = `${daysDiff} days`;
    } else if (daysDiff <= 14) {
      duration = daysDiff === 7 ? "one week" : `${Math.ceil(daysDiff / 7)} weeks`;
    } else if (daysDiff <= 30) {
      duration = `${Math.ceil(daysDiff / 7)} weeks`;
    } else {
      const months = Math.ceil(daysDiff / 30);
      duration = months === 1 ? "one month" : `${months} months`;
    }

    let instructor = data.instructor;
    let content = `Completed a structured ${data.courseName} online course through the collaborative 'STEM for Society' program, delivered by ${instructor}.`;

    const fontSize = 12;
    const y = 300;
    const xStart = 75;
    // Keep the right margin equal to the left one instead of the old fixed
    // 500pt, which sat 20pt short of the page edge and ignored page width.
    const maxX = firstPage.getWidth() - xStart;

    function drawStyledText(
      x: number,
      y: number,
      styles: { font: PDFFont; size?: number; color?: Color; text: string }[],
    ) {
      let currentX = x;
      let currentY = y;
      const lineHeight = 1.5 * fontSize;
      for (const style of styles) {
        const size = style.size || fontSize;
        const width = style.font.widthOfTextAtSize(style.text, size);

        /**
         * Measure before drawing. The previous version drew the word first and
         * only then checked whether the cursor had passed the limit, so the
         * word that crossed the margin was already painted - it ran off the
         * right edge of the page and only the *following* word moved down.
         * The currentX > x guard keeps a single over-long word from looping.
         */
        if (currentX + width > maxX && currentX > x) {
          currentX = x;
          currentY -= lineHeight;
        }

        firstPage.drawText(style.text, {
          x: currentX,
          y: currentY,
          font: style.font,
          size,
          color: style.color || CERT_BODY_COLOR,
        });
        currentX += width;
      }
    }

    let wordObjects = [
      [
        { text: "Completed ", font: font },
        { text: "a ", font: font },
        { text: "structured ", font: font },
        { text: " ", font: font },
      ],
      [
        { text: " ", font: font },
        { text: "online ", font: font },
        { text: "course ", font: font },
        { text: "(duration: ", font: font },
        { text: " ", font: font },
      ],
      [
        { text: ") ", font: font },
        { text: "through ", font: font },
        { text: "the ", font: font },
        { text: "collaborative ", font: font },
        { text: "'STEM ", font: font },
        { text: "for ", font: font },
        { text: "Society' ", font: font },
        { text: "program ", font: font },
        { text: "delivered ", font: font },
        { text: "by ", font: font },
        { text: " ", font: font },
      ],
      [{ text: ".", font: font }],
    ];

    let keys = [
      data.courseName.split(" "),
      duration.split(" "),
      instructor.split(" "),
    ];

    let keyObjects = keys.map((innerArray) =>
      innerArray.map((key) => ({
        text: key + " ",
        font: boldFont,
        color: CERT_ACCENT_COLOR,
      })),
    );
    
    console.log(wordObjects, keyObjects);
    drawStyledText(xStart, y, [
      ...wordObjects[0], //Completed a structured
      ...keyObjects[0],
      ...wordObjects[1], // online course (duration:
      ...keyObjects[1],
      ...wordObjects[2], // through the collaborative 'STEM for Society' program, delivered by
      ...keyObjects[2],
    ]);

    // Add digital signature if available
    if (data.digitalSignUrl) {
      try {
        // Fetch the digital signature image
        const signatureResponse = await fetch(data.digitalSignUrl);
        if (signatureResponse.ok) {
          const signatureBytes = await signatureResponse.arrayBuffer();
          
          // Determine image type and embed accordingly
          let signatureImage;
          const contentType = signatureResponse.headers.get('content-type');
          
          if (contentType?.includes('png')) {
            signatureImage = await pdfDoc.embedPng(signatureBytes);
          } else if (contentType?.includes('jpeg') || contentType?.includes('jpg')) {
            signatureImage = await pdfDoc.embedJpg(signatureBytes);
          } else {
            // Default to PNG if content type is unclear
            signatureImage = await pdfDoc.embedPng(signatureBytes);
          }

          // Calculate signature dimensions and position
          const signatureWidth = 80; // Adjust as needed
          const signatureHeight = 80; // Adjust as needed
          const signatureX = 400; 
          const signatureY = 150; 

          // Draw the signature
          firstPage.drawImage(signatureImage, {
            x: signatureX,
            y: signatureY,
            width: signatureWidth,
            height: signatureHeight,
          });

          console.log("Digital signature added to certificate");
        } else {
          console.warn("Could not fetch digital signature image");
        }
      } catch (signatureError) {
        console.error("Error adding digital signature:", signatureError);
        // Continue without signature if there's an error
      }
    }

    if(data.logo){
      try{
        const logoResponse = await fetch(data.logo);
        if(logoResponse.ok){
          const logoBytes = await logoResponse.arrayBuffer();
          let logoImage;
          const contentType = logoResponse.headers.get('content-type');

          if (contentType?.includes('png')) {
            logoImage = await pdfDoc.embedPng(logoBytes);
          } else if (contentType?.includes('jpeg') || contentType?.includes('jpg')) {
            logoImage = await pdfDoc.embedJpg(logoBytes);
          } else {
            // Default to PNG if content type is unclear
            logoImage = await pdfDoc.embedPng(logoBytes);
          }
          

          // Calculate signature dimensions and position
          const signatureWidth = 80; // Adjust as needed
          const signatureHeight = 80; // Adjust as needed
          const signatureX = 255; 
          const signatureY = 721; 

          // Draw the logo
          firstPage.drawImage(logoImage, {
            x: signatureX,
            y: signatureY,
            width: signatureWidth,
            height: signatureHeight,
          });

          console.log("Logo added to certificate");
        } else {
          console.warn("Could not fetch logo image");
        }
      } catch (logoError) {
        console.error("Error adding logo:", logoError);
        // Continue without logo if there's an error
      }
    }

    // Add certificate ID
    firstPage.drawText(data.certificateId, {
      x: 120,
      y: 170,
      size: 6,
      font,
      color: CERT_MUTED_COLOR,
    });

    const pdfBuffer = await pdfDoc.save();
    const pdfName = slugify(
      data.courseName + "-" + data.name + "-" + data.certificateId + "-",
    );
    const pdfFile = new File([new Uint8Array(pdfBuffer)], pdfName, { type: "application/pdf" });

    const { data: pdfURL, error } = await supabase.storage
      .from("s4s-media")
      .upload(`certificates/${pdfName}.pdf`, pdfFile, {
        upsert: true,
        contentType: "application/pdf",
      });

    debugLog("🚀 ~ generateCertificate ~ pdfURL:", pdfURL);
    if (error) {
      console.log("PDF upload error: ", error.message);
      return false;
    }
    await db
      .update(trainingEnrolmentTable)
      .set({
        certificateNo: data.certificateId,
        certificate:
          SUPABASE_PROJECT_URL + "/storage/v1/object/public/" + pdfURL.fullPath,
      })
      .where(eq(trainingEnrolmentTable.id, data.enrolmentId));
    return true;
  } catch (error) {
    console.error("Error generating certificate:", error);
    return false;
  }
}
