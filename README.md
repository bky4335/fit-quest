# FIT QUEST 백엔드: 주변 시설 추천

## 구조
```
앱(웹) ──POST──> Supabase Edge Function (nearby-facilities)
                    ├─ 카카오 로컬 API (키워드 검색, 주소→좌표)
                    └─ partner_facilities 테이블 (제휴·광고 정보 결합)
                 ──> 적합도 순 정렬 결과 반환
```
카카오 REST API 키는 서버(Edge Function)에서만 사용하고 앱에는 노출하지 않아요.

## 준비
1. [Kakao Developers](https://developers.kakao.com)에서 앱을 만들고 **REST API 키**를 발급, 카카오맵(로컬) 사용 설정을 켜요.
2. Supabase CLI 설치 후 프로젝트 연결:
   ```bash
   supabase link --project-ref <프로젝트 ID>
   supabase db push                      # 001_partners.sql 적용
   supabase secrets set KAKAO_REST_API_KEY=<REST API 키>
   supabase functions deploy nearby-facilities
   ```
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function에 자동 주입돼요.

## 호출 예시
```bash
curl -X POST "https://<ref>.supabase.co/functions/v1/nearby-facilities" \
  -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
  -d '{"area":"부천 중동","pref":"solo","radius":2000,"limit":8}'
```
- `pref`: `solo`(헬스 위주) / `social`(복싱·그룹운동) / `mix`
- 위치 권한을 받은 경우 `{"lat":37.49,"lng":126.78}`을 보내요.

프론트에서는:
```js
const r = await fetch(FUNCTION_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
  body: JSON.stringify({ lat, lng, pref }),
});
const { facilities } = await r.json();
// facilities[i].isAd === true 이면 "광고·제휴" 배지 표시
```

## 주의
- **지금 게시한 FIT QUEST 페이지(claude.ai 호스팅)는 외부 서버 호출이 막혀 있어요.** 이 함수를 쓰려면 프론트를 Vercel, Netlify, Supabase Hosting 등에 배포해야 해요.
- 카카오 로컬 API는 장소 **검색**용이에요. 가격, 체험권, 초보자 프로그램 정보는 없어서 제휴 업체가 직접 `partner_facilities`에 등록해야 해요. 비제휴 시설은 "가격은 시설에 문의"로 표시해요.
- 카카오 이용약관상 검색 결과의 저장·재가공 범위를 운영 전에 확인하세요. 코드는 10분 메모리 캐시만 써요.
- 광고(`is_ad`)는 배지로만 표시하고 정렬 점수에는 반영하지 않아요.
- 체험 신청 연락처는 개인정보라 수집 동의, 최소 보관, 접근 제한이 필요해요.
- 러닝크루 모집 정보는 카카오 API로 못 가져와요. 별도 수집·검증 파이프라인이 필요해요.

## 프론트엔드 설정 (frontend/index.html)
파일 맨 위 `CFG`에 값을 채우면 "내 주변 실제 시설 찾기" 버튼이 켜져요. 비워 두면 샘플 카드만 보여요.
```js
var CFG={SUPABASE_URL:'https://<ref>.supabase.co', ANON_KEY:'<anon key>', NAVER_MAP_CLIENT_ID:'<네이버 클라우드 Maps 키>'};
```
- 네이버 지도를 쓰려면 네이버 클라우드 콘솔에서 Maps 앱을 만들고, 배포 주소(예: `https://<아이디>.github.io`)를 Web 서비스 URL에 등록해야 해요.
- 지도 키가 없어도 시설 목록은 나와요(지도만 숨겨져요).
- 시설 검색은 카카오 로컬 API, 지도 표시는 네이버 지도예요.
