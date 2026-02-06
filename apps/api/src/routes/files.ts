import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { env } from '../config/env';

const router = Router();

// ---------------------------------------------------------------------------
// Upload directory -- ensure it exists at module load time
// ---------------------------------------------------------------------------
const UPLOAD_DIR = path.resolve(env.FILE_STORAGE_PATH, 'uploads');
fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Allowed MIME types
// ---------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel',                                         // xls
  'text/csv',                                                         // csv
  'application/pdf',                                                  // pdf
  'image/png',                                                        // png
  'image/jpeg',                                                       // jpg, jpeg
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword',                                               // doc
]);

const ALLOWED_EXTENSIONS = new Set([
  '.xlsx', '.xls', '.csv', '.pdf', '.png', '.jpg', '.jpeg', '.docx', '.doc',
]);

// ---------------------------------------------------------------------------
// Multer configuration
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    // Ensure directory exists (defensive, already created above)
    fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    // Temporary name – will be renamed after hashing
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME_TYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new AppError(400, 'INVALID_FILE_TYPE', '허용되지 않는 파일 형식입니다. (xlsx, xls, csv, pdf, png, jpg, jpeg, docx, doc만 허용)'));
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute SHA-256 hash of a file on disk. */
async function computeFileHash(filePath: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  mimeType: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 1. POST /api/files/upload – 파일 업로드
// ---------------------------------------------------------------------------
router.post(
  '/upload',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      throw new AppError(400, 'FILE_REQUIRED', '파일이 필요합니다.');
    }

    const user = req.user!;

    // Compute SHA-256 hash
    const tempPath = file.path;
    const fileHash = await computeFileHash(tempPath);

    // Rename file to hash-based name
    const ext = path.extname(file.originalname).toLowerCase();
    const hashFilename = `${fileHash}${ext}`;
    const finalPath = path.join(UPLOAD_DIR, hashFilename);

    // If a file with the same hash already exists, remove the temp upload
    try {
      await fs.access(finalPath);
      // File already exists – remove temp
      await fs.unlink(tempPath);
    } catch {
      // File does not exist yet – rename
      await fs.rename(tempPath, finalPath);
    }

    // Create DB record
    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        originalName: file.originalname,
        storagePath: finalPath,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileHash,
        uploadedById: user.id,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: uploadedFile.id,
        originalName: uploadedFile.originalName,
        mimeType: uploadedFile.mimeType,
        fileSize: uploadedFile.fileSize,
        fileHash: uploadedFile.fileHash,
        createdAt: uploadedFile.createdAt,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// 2. GET /api/files/:id – 파일 메타데이터 조회
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const file = await prisma.uploadedFile.findUnique({
      where: { id },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        fileSize: true,
        fileHash: true,
        uploadedById: true,
        createdAt: true,
        uploadedBy: {
          select: { name: true },
        },
      },
    });

    if (!file) {
      throw new AppError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없습니다.');
    }

    res.json({ success: true, data: file });
  }),
);

// ---------------------------------------------------------------------------
// 3. GET /api/files/:id/download – 파일 다운로드
// ---------------------------------------------------------------------------
router.get(
  '/:id/download',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const file = await prisma.uploadedFile.findUnique({
      where: { id },
    });

    if (!file) {
      throw new AppError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없습니다.');
    }

    // Verify the file exists on disk
    try {
      await fs.access(file.storagePath);
    } catch {
      throw new AppError(404, 'FILE_MISSING', '파일이 디스크에 존재하지 않습니다.');
    }

    // Encode filename for Content-Disposition (RFC 5987)
    const encodedName = encodeURIComponent(file.originalName).replace(/['()]/g, escape);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodedName}`,
    );
    res.setHeader('Content-Length', file.fileSize);

    const readStream = fsSync.createReadStream(file.storagePath);
    readStream.pipe(res);
  }),
);

// ---------------------------------------------------------------------------
// 4. GET /api/files – 파일 목록 조회
// ---------------------------------------------------------------------------
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const { page, limit, mimeType } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (mimeType) {
      where.mimeType = mimeType;
    }

    const [items, total] = await Promise.all([
      prisma.uploadedFile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          fileSize: true,
          fileHash: true,
          uploadedById: true,
          createdAt: true,
          uploadedBy: {
            select: { name: true },
          },
        },
      }),
      prisma.uploadedFile.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// 5. DELETE /api/files/:id – 파일 삭제 (소프트: DB 레코드만 삭제)
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = req.user!;

    const file = await prisma.uploadedFile.findUnique({
      where: { id },
    });

    if (!file) {
      throw new AppError(404, 'FILE_NOT_FOUND', '파일을 찾을 수 없습니다.');
    }

    // Only the uploader or a superadmin can delete
    if (file.uploadedById !== user.id && !user.isSuperAdmin) {
      throw new AppError(403, 'FORBIDDEN', '파일을 삭제할 권한이 없습니다.');
    }

    await prisma.uploadedFile.delete({
      where: { id },
    });

    res.json({ success: true });
  }),
);

export default router;
