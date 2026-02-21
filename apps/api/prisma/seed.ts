import { PrismaClient, PermissionResource, PermissionAction, UserRole, BedStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// 타입 정의
// ---------------------------------------------------------------------------

interface DepartmentSeed {
  name: string;
  code: string;
  parentId: string | null;
}

interface UserSeed {
  loginId: string;
  password: string;
  name: string;
  isSuperAdmin: boolean;
  departmentCode?: string;
  role?: UserRole;
}

interface PermissionSeed {
  resource: PermissionResource;
  action: PermissionAction;
  scope?: string;
}

interface WardSeed {
  name: string;
  floor: number;
  rooms: {
    name: string;
    capacity: number;
    beds: { label: string; status: BedStatus }[];
  }[];
}

interface ProcedureSeed {
  name: string;
  category: string;
  defaultUnitPrice: number;
}

// ---------------------------------------------------------------------------
// 시드 데이터 정의
// ---------------------------------------------------------------------------

const departments: DepartmentSeed[] = [
  { name: '원장실', code: 'DIRECTOR', parentId: null },
  { name: '간호부', code: 'NURSING', parentId: null },
  { name: '원무과', code: 'ADMIN_OFFICE', parentId: null },
  { name: '가정방문팀', code: 'HOMECARE', parentId: null },
  { name: '진료과', code: 'MEDICAL', parentId: null },
];

const users: UserSeed[] = [
  {
    loginId: 'admin',
    password: 'admin1234',
    name: '시스템관리자',
    isSuperAdmin: true,
  },
  {
    loginId: 'nurse1',
    password: 'nurse1234',
    name: '이간호사',
    isSuperAdmin: false,
    departmentCode: 'NURSING',
    role: 'HEAD_NURSE' as UserRole,
  },
  {
    loginId: 'staff1',
    password: 'staff1234',
    name: '박직원',
    isSuperAdmin: false,
    departmentCode: 'ADMIN_OFFICE',
    role: 'STAFF' as UserRole,
  },
  {
    loginId: 'homecare1',
    password: 'homecare1234',
    name: '최방문',
    isSuperAdmin: false,
    departmentCode: 'HOMECARE',
    role: 'HOMECARE_STAFF' as UserRole,
  },
];

/** 부서별 권한 매핑 (departmentCode -> permissions) */
const departmentPermissions: Record<string, PermissionSeed[]> = {
  MEDICAL: [
    { resource: 'BEDS', action: 'READ' },
    { resource: 'BEDS', action: 'WRITE' },
    { resource: 'BEDS', action: 'APPROVE' },
    { resource: 'ADMISSIONS', action: 'READ' },
    { resource: 'ADMISSIONS', action: 'WRITE' },
    { resource: 'ADMISSIONS', action: 'APPROVE' },
    { resource: 'PROCEDURES', action: 'READ' },
    { resource: 'PROCEDURES', action: 'WRITE' },
    { resource: 'PROCEDURES', action: 'APPROVE' },
    { resource: 'APPOINTMENTS', action: 'READ' },
    { resource: 'APPOINTMENTS', action: 'WRITE' },
    { resource: 'APPOINTMENTS', action: 'APPROVE' },
    { resource: 'HOMECARE_VISITS', action: 'READ' },
    { resource: 'HOMECARE_VISITS', action: 'WRITE' },
    { resource: 'HOMECARE_VISITS', action: 'APPROVE' },
    { resource: 'QUESTIONNAIRES', action: 'READ' },
    { resource: 'QUESTIONNAIRES', action: 'WRITE' },
    { resource: 'QUESTIONNAIRES', action: 'APPROVE' },
    { resource: 'LAB_RESULTS', action: 'READ' },
    { resource: 'LAB_RESULTS', action: 'WRITE' },
    { resource: 'LAB_RESULTS', action: 'APPROVE' },
    { resource: 'AI_REPORTS', action: 'READ' },
    { resource: 'AI_REPORTS', action: 'WRITE' },
    { resource: 'AI_REPORTS', action: 'APPROVE' },
    { resource: 'DASHBOARD', action: 'READ' },
  ],
  NURSING: [
    { resource: 'BEDS', action: 'READ' },
    { resource: 'BEDS', action: 'WRITE' },
    { resource: 'ADMISSIONS', action: 'READ' },
    { resource: 'ADMISSIONS', action: 'WRITE' },
    { resource: 'PROCEDURES', action: 'READ' },
    { resource: 'PROCEDURES', action: 'WRITE' },
    { resource: 'HOMECARE_VISITS', action: 'READ' },
    { resource: 'HOMECARE_VISITS', action: 'WRITE' },
    { resource: 'QUESTIONNAIRES', action: 'READ' },
    { resource: 'QUESTIONNAIRES', action: 'WRITE' },
    { resource: 'DASHBOARD', action: 'READ' },
  ],
  ADMIN_OFFICE: [
    { resource: 'APPOINTMENTS', action: 'READ' },
    { resource: 'APPOINTMENTS', action: 'WRITE' },
    { resource: 'ADMISSIONS', action: 'READ' },
    { resource: 'ADMISSIONS', action: 'WRITE' },
    { resource: 'BEDS', action: 'READ' },
    { resource: 'DASHBOARD', action: 'READ' },
  ],
  HOMECARE: [
    { resource: 'HOMECARE_VISITS', action: 'READ' },
    { resource: 'HOMECARE_VISITS', action: 'WRITE' },
    { resource: 'QUESTIONNAIRES', action: 'READ' },
    { resource: 'QUESTIONNAIRES', action: 'WRITE' },
    { resource: 'LAB_RESULTS', action: 'READ' },
    { resource: 'LAB_RESULTS', action: 'WRITE' },
    { resource: 'DASHBOARD', action: 'READ' },
  ],
  DIRECTOR: (() => {
    const allResources: PermissionResource[] = [
      'BEDS',
      'ADMISSIONS',
      'PROCEDURES',
      'APPOINTMENTS',
      'HOMECARE_VISITS',
      'QUESTIONNAIRES',
      'LAB_RESULTS',
      'AI_REPORTS',
      'INBOX',
      'AUDIT_LOGS',
      'IMPORTS',
      'USERS',
      'DEPARTMENTS',
      'CHATBOT',
      'DASHBOARD',
    ];
    const allActions: PermissionAction[] = ['READ', 'WRITE', 'APPROVE', 'ADMIN'];
    const perms: PermissionSeed[] = [];
    for (const resource of allResources) {
      for (const action of allActions) {
        perms.push({ resource, action, scope: 'ALL' });
      }
    }
    return perms;
  })(),
};

const wards: WardSeed[] = [
  {
    name: '1병동',
    floor: 2,
    rooms: [
      {
        name: '101호',
        capacity: 2,
        beds: [
          { label: 'A', status: 'EMPTY' as BedStatus },
          { label: 'B', status: 'EMPTY' as BedStatus },
        ],
      },
      {
        name: '102호',
        capacity: 2,
        beds: [
          { label: 'A', status: 'EMPTY' as BedStatus },
          { label: 'B', status: 'EMPTY' as BedStatus },
        ],
      },
    ],
  },
  {
    name: '2병동',
    floor: 3,
    rooms: [
      {
        name: '201호',
        capacity: 2,
        beds: [
          { label: 'A', status: 'EMPTY' as BedStatus },
          { label: 'B', status: 'EMPTY' as BedStatus },
        ],
      },
      {
        name: '202호',
        capacity: 2,
        beds: [
          { label: 'A', status: 'EMPTY' as BedStatus },
          { label: 'B', status: 'EMPTY' as BedStatus },
        ],
      },
    ],
  },
];

const procedureCatalogItems: ProcedureSeed[] = [
  { name: '수액주사', category: '주사', defaultUnitPrice: 15000 },
  { name: '상처소독', category: '처치', defaultUnitPrice: 8000 },
  { name: '물리치료', category: '재활', defaultUnitPrice: 20000 },
];

// ---------------------------------------------------------------------------
// 메인 시드 함수
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('🏥 서울온케어 그룹웨어 시드 데이터 생성 시작...\n');

  // --------------------------------------------------
  // 1. 부서(Department) 생성
  // --------------------------------------------------
  console.log('▶ 부서 생성 중...');
  const deptMap = new Map<string, string>(); // code -> id

  for (const dept of departments) {
    const upserted = await prisma.department.upsert({
      where: { code: dept.code },
      update: { name: dept.name, parentId: dept.parentId, isActive: true },
      create: { name: dept.name, code: dept.code, parentId: dept.parentId },
    });
    deptMap.set(dept.code, upserted.id);
    console.log(`  ✓ ${dept.name} (${dept.code})`);
  }

  // --------------------------------------------------
  // 2. 사용자(User) 생성
  // --------------------------------------------------
  console.log('\n▶ 사용자 생성 중...');
  const SALT_ROUNDS = 12;

  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, SALT_ROUNDS);

    const upserted = await prisma.user.upsert({
      where: { loginId: u.loginId },
      update: {
        name: u.name,
        passwordHash,
        isSuperAdmin: u.isSuperAdmin,
        isActive: true,
      },
      create: {
        loginId: u.loginId,
        passwordHash,
        name: u.name,
        isSuperAdmin: u.isSuperAdmin,
      },
    });

    // 부서 배정 (SUPER_ADMIN 제외)
    if (u.departmentCode && u.role) {
      const departmentId = deptMap.get(u.departmentCode);
      if (departmentId) {
        await prisma.userDepartment.upsert({
          where: {
            userId_departmentId: {
              userId: upserted.id,
              departmentId,
            },
          },
          update: { role: u.role, isPrimary: true },
          create: {
            userId: upserted.id,
            departmentId,
            role: u.role,
            isPrimary: true,
          },
        });
      }
    }

    console.log(`  ✓ ${u.name} (${u.loginId})`);
  }

  // --------------------------------------------------
  // 3. 부서 권한(DepartmentPermission) 생성
  // --------------------------------------------------
  console.log('\n▶ 부서 권한 생성 중...');

  for (const [deptCode, permissions] of Object.entries(departmentPermissions)) {
    const departmentId = deptMap.get(deptCode);
    if (!departmentId) {
      console.warn(`  ⚠ 부서 코드 ${deptCode}를 찾을 수 없습니다.`);
      continue;
    }

    for (const perm of permissions) {
      await prisma.departmentPermission.upsert({
        where: {
          departmentId_resource_action: {
            departmentId,
            resource: perm.resource,
            action: perm.action,
          },
        },
        update: { scope: perm.scope ?? 'OWN_DEPT' },
        create: {
          departmentId,
          resource: perm.resource,
          action: perm.action,
          scope: perm.scope ?? 'OWN_DEPT',
        },
      });
    }

    console.log(`  ✓ ${deptCode}: ${permissions.length}개 권한`);
  }

  // --------------------------------------------------
  // 4. 병동 / 호실 / 병상 생성
  // --------------------------------------------------
  console.log('\n▶ 병동·호실·병상 생성 중...');

  for (const ward of wards) {
    const upsertedWard = await prisma.ward.upsert({
      where: { name: ward.name },
      update: { floor: ward.floor, isActive: true },
      create: { name: ward.name, floor: ward.floor },
    });

    for (const room of ward.rooms) {
      const upsertedRoom = await prisma.room.upsert({
        where: {
          wardId_name: {
            wardId: upsertedWard.id,
            name: room.name,
          },
        },
        update: { capacity: room.capacity, isActive: true },
        create: {
          wardId: upsertedWard.id,
          name: room.name,
          capacity: room.capacity,
        },
      });

      for (const bed of room.beds) {
        await prisma.bed.upsert({
          where: {
            roomId_label: {
              roomId: upsertedRoom.id,
              label: bed.label,
            },
          },
          update: { status: bed.status, isActive: true },
          create: {
            roomId: upsertedRoom.id,
            label: bed.label,
            status: bed.status,
          },
        });
      }
    }

    console.log(`  ✓ ${ward.name} (${ward.floor}층) - ${ward.rooms.length}개 호실`);
  }

  // --------------------------------------------------
  // 5. 처치 카탈로그(ProcedureCatalog) 생성
  // --------------------------------------------------
  console.log('\n▶ 처치 카탈로그 생성 중...');

  for (const item of procedureCatalogItems) {
    await prisma.procedureCatalog.upsert({
      where: { name: item.name },
      update: {
        category: item.category,
        defaultUnitPrice: item.defaultUnitPrice,
        isActive: true,
      },
      create: {
        name: item.name,
        category: item.category,
        defaultUnitPrice: item.defaultUnitPrice,
      },
    });
    console.log(`  ✓ ${item.name} (${item.category}, ${item.defaultUnitPrice.toLocaleString()}원)`);
  }

  console.log('\n✅ 시드 데이터 생성 완료!\n');
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

main()
  .catch((e: Error) => {
    console.error('❌ 시드 실행 중 오류 발생:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
