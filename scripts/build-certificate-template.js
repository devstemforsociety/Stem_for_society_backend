/**
 * One-off asset build: sample.pdf's background is a pure greyscale A4 image, so
 * the whole certificate printed as black-on-white. This maps ink density onto
 * the brand ramp (white -> accent blue -> deep navy) and writes a coloured
 * template. Run once; the generator just loads the result.
 */
const fs=require("fs"), zlib=require("zlib"), path=require("path");
const B=path.join(__dirname,"..")+"/";
const { PDFDocument } = require("pdf-lib");

const hex=(h)=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const WHITE=[255,255,255], ACCENT=hex("#0389FF"), NAVY=hex("#0B3B76");
const lerp=(a,b,t)=>a+(b-a)*t;

function ramp(t){ // t = ink amount, 0 = paper, 1 = solid ink
  if(t<=0.5){ const k=t/0.5; return [0,1,2].map(i=>lerp(WHITE[i],ACCENT[i],k)); }
  const k=(t-0.5)/0.5; return [0,1,2].map(i=>lerp(ACCENT[i],NAVY[i],k));
}

// --- extract the single image XObject from the source PDF -------------------
const src=fs.readFileSync(B+"src/assets/sample.pdf").toString("latin1");
const i=src.search(/\/Subtype\s*\/Image/);
const st=src.indexOf("stream",i);
const dataStart=st+(src[st+6]==="\r"?8:7);
const raw=Buffer.from(src.slice(dataStart,src.indexOf("endstream",dataStart)),"latin1");
const W=+src.slice(i,i+400).match(/\/Width\s+(\d+)/)[1];
const H=+src.slice(i,i+400).match(/\/Height\s+(\d+)/)[1];
const px=zlib.inflateSync(raw);
console.log(`source image ${W}x${H}, ${px.length} bytes`);

// --- recolour --------------------------------------------------------------
const lut=Array.from({length:256},(_,v)=>ramp(1-v/255).map(Math.round));
const out=Buffer.allocUnsafe(px.length);
for(let p=0;p<px.length;p+=3){
  const lum=(px[p]*299+px[p+1]*587+px[p+2]*114)/1000|0;
  const c=lut[lum];
  out[p]=c[0]; out[p+1]=c[1]; out[p+2]=c[2];
}

// --- encode as PNG so pdf-lib can embed it ---------------------------------
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}
  let x=0xFFFFFFFF;for(const b of buf)x=t[(x^b)&255]^(x>>>8);return (x^0xFFFFFFFF)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const td=Buffer.concat([Buffer.from(type,"latin1"),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len,td,crc]);}
const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4);
ihdr[8]=8; ihdr[9]=2; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;   // 8-bit truecolour
const stride=W*3;
const rows=Buffer.allocUnsafe((stride+1)*H);
for(let y=0;y<H;y++){ rows[y*(stride+1)]=0; out.copy(rows,y*(stride+1)+1,y*stride,(y+1)*stride); }
const png=Buffer.concat([
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
  chunk("IHDR",ihdr), chunk("IDAT",zlib.deflateSync(rows,{level:9})), chunk("IEND",Buffer.alloc(0)),
]);
console.log("png bytes:",png.length);

// --- rebuild the template PDF at the same page size ------------------------
(async()=>{
  const srcDoc=await PDFDocument.load(fs.readFileSync(B+"src/assets/sample.pdf"));
  const {width,height}=srcDoc.getPages()[0].getSize();
  const doc=await PDFDocument.create();
  const page=doc.addPage([width,height]);
  page.drawImage(await doc.embedPng(png),{x:0,y:0,width,height});
  const bytes=await doc.save();
  fs.writeFileSync(B+"src/assets/sample-color.pdf", bytes);
  console.log(`wrote src/assets/sample-color.pdf (${bytes.length} bytes, ${Math.round(width)}x${Math.round(height)})`);
})();
