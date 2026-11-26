-- 제휴 시설: 카카오 장소 ID로 검색 결과와 연결
create table if not exists partner_facilities (
  kakao_place_id    text primary key,
  name              text not null,
  is_ad             boolean not null default false,  -- 광고 상품 여부 (순위에는 반영 안 함)
  beginner_friendly boolean not null default false,
  trial_info        text,        -- 예: '1일 무료 체험'
  price_info        text,        -- 예: '월 5~6만원대'
  contact_url       text,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- 체험 신청 기록: 전환 수수료 정산용
create table if not exists facility_leads (
  id              uuid primary key default gen_random_uuid(),
  kakao_place_id  text not null references partner_facilities(kakao_place_id),
  user_id         uuid,                       -- 로그인 도입 후 auth.users 연결
  contact         text not null,              -- 연락처 (민감정보: 최소 수집·보관 기간 제한)
  status          text not null default 'requested'
                  check (status in ('requested','trial_done','joined','cancelled')),
  created_at      timestamptz not null default now()
);

-- RLS: 클라이언트 직접 접근 차단, Edge Function(service role)만 사용
alter table partner_facilities enable row level security;
alter table facility_leads enable row level security;

create index if not exists leads_place_idx on facility_leads(kakao_place_id, status);
