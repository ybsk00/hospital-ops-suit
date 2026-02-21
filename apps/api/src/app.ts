import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { env } from './config/env';
import { globalErrorHandler } from './middleware/errorHandler';

import authRoutes from './routes/auth';
import bedRoutes from './routes/beds';
import admissionRoutes from './routes/admissions';
import procedureRoutes from './routes/procedures';
import appointmentRoutes from './routes/appointments';
import homecareRoutes from './routes/homecare';
import inboxRoutes from './routes/inbox';
import importRoutes from './routes/imports';
import auditRoutes from './routes/audit';
import adminRoutes from './routes/admin';
import chatbotRoutes from './routes/chatbot';
import dashboardRoutes from './routes/dashboard';
import fileRoutes from './routes/files';
import aiReportRoutes from './routes/aiReports';
import labResultRoutes from './routes/labResults';
import labUploadRoutes from './routes/labUploads';
import labApprovalRoutes from './routes/labApprovals';
import marketingRoutes from './routes/marketing';
import patientChatbotRoutes from './routes/patientChatbot';
import youtubeRoutes from './routes/youtube';
import therapistRoutes from './routes/therapists';
import manualTherapyRoutes from './routes/manualTherapy';
import staffNoteRoutes from './routes/staffNotes';
import rfScheduleRoutes from './routes/rfSchedule';
import roomBookingRoutes from './routes/roomBooking';
import handoverRoutes from './routes/handover';
import rfEvaluationRoutes from './routes/rfEvaluation';
import doctorScheduleRoutes from './routes/doctorSchedule';

const app = express();

// 공통 미들웨어
app.use(helmet());

// CORS 설정 (환자 챗봇은 공개 API이므로 유연하게 처리)
const corsOrigins = env.CORS_ORIGIN.split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    // origin이 없는 경우 (서버 간 요청, curl 등) 허용
    if (!origin) {
      callback(null, true);
      return;
    }
    // 설정된 origin 목록에 있거나, Cloud Run 도메인인 경우 허용
    if (corsOrigins.includes(origin) || origin.includes('.run.app')) {
      callback(null, origin);
    } else {
      // 개발 환경 또는 localhost는 허용
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        callback(null, origin);
      } else {
        callback(null, false);
      }
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (env.isDev) {
  app.use(morgan('dev'));
}

// 라우트
app.use('/api/auth', authRoutes);
app.use('/api/beds', bedRoutes);
app.use('/api/admissions', admissionRoutes);
app.use('/api/procedures', procedureRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/homecare', homecareRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/ai-reports', aiReportRoutes);
app.use('/api/lab-results', labResultRoutes);
app.use('/api/lab-uploads', labUploadRoutes);
app.use('/api/lab-approvals', labApprovalRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/patient-chatbot', patientChatbotRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/therapists', therapistRoutes);
app.use('/api/manual-therapy', manualTherapyRoutes);
app.use('/api/staff-notes', staffNoteRoutes);
app.use('/api/rf-schedule', rfScheduleRoutes);
app.use('/api/room-booking', roomBookingRoutes);
app.use('/api/handover', handoverRoutes);
app.use('/api/rf-evaluation', rfEvaluationRoutes);
app.use('/api/doctor-schedule', doctorScheduleRoutes);

// 헬스 체크
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 글로벌 에러 핸들러
app.use(globalErrorHandler);

export default app;
