// FIT QUEST - 주변 운동 시설 추천 Edge Function
// POST { lat?, lng?, area?, pref: "solo"|"social"|"mix", radius?, limit? }
import { createClient } from "npm:@supabase/supabase-js@2";

const KAKAO = "https://dapi.kakao.com/v2/local/search";
const CORS = {
  "Access-Control-Allow-Origin": "*", // 운영 시 실제 프론트 도메인으로 제한
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Pref = "solo" | "social" | "mix";
const QUERIES: Record<Pref, { q: string; kind: string }[]> = {
  solo: [{ q: "헬스장", kind: "헬스" }],
  social: [
    { q: "복싱장", kind: "복싱" },
    { q: "크로스핏", kind: "그룹운동" },
    { q: "필라테스", kind: "그룹운동" },
  ],
  mix: [
    { q: "헬스장", kind: "헬스" },
    { q: "복싱장", kind: "복싱" },
  ],
};
const KIND_PREF: Record<string, Pref[]> = {
  헬스: ["solo", "mix"],
  복싱: ["social", "mix"],
  그룹운동: ["social"],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

async function kakao(path: string, params: Record<string, string | number>) {
  const url = new URL(`${KAKAO}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${Deno.env.get("KAKAO_REST_API_KEY")}` },
  });
  if (!res.ok) throw new Error(`kakao ${path} ${res.status}`);
  return res.json();
}

// 좌표가 있으면 그대로, 없으면 동네 이름으로 중심 좌표를 찾는다.
async function resolveCenter(b: any): Promise<{ lat: number; lng: number } | null> {
  if (typeof b.lat === "number" && typeof b.lng === "number") {
    const ok = b.lat > 33 && b.lat < 39 && b.lng > 124 && b.lng < 132; // 대한민국 범위
    return ok ? { lat: b.lat, lng: b.lng } : null;
  }
  if (typeof b.area === "string" && b.area.trim().length > 0) {
    const area = b.area.trim().slice(0, 40);
    let d = await kakao("address.json", { query: area, size: 1 });
    if (!d.documents?.length) d = await kakao("keyword.json", { query: area, size: 1 });
    const p = d.documents?.[0];
    if (p) return { lat: Number(p.y), lng: Number(p.x) };
  }
  return null;
}

// 적합도 점수: 광고(is_ad) 여부는 점수에 절대 반영하지 않는다.
function score(f: any, pref: Pref, radius: number, partner: any) {
  const reasons: string[] = [];
  let s = 0;
  if (KIND_PREF[f.kind]?.includes(pref)) {
    s += 3;
    reasons.push(pref === "solo" ? "혼자 집중해서 운동하기 좋은 유형" : "함께 운동하기 좋은 유형");
  }
  const near = Math.max(0, 1 - f.distanceM / radius) * 3;
  s += near;
  if (f.distanceM <= 800) reasons.push("도보 10분 안팎");
  if (partner?.beginner_friendly) { s += 2; reasons.push("초보자 프로그램 있음"); }
  if (partner?.trial_info) { s += 1; reasons.push("체험 가능"); }
  if (/초보|입문|원데이/.test(f.name)) s += 1;
  return { s, reasons };
}

const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 10 * 60 * 1000; // 10분. 카카오 이용약관의 저장·캐시 조건을 운영 전 확인하세요.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const b = await req.json();
    const pref: Pref = ["solo", "social", "mix"].includes(b.pref) ? b.pref : "mix";
    const radius = Math.min(Math.max(Number(b.radius) || 2000, 500), 5000);
    const limit = Math.min(Math.max(Number(b.limit) || 10, 1), 20);

    const center = await resolveCenter(b);
    if (!center) return json({ error: "위치를 확인할 수 없어요. 동네 이름이나 위치 권한을 확인해 주세요." }, 400);

    const key = `${center.lat.toFixed(3)},${center.lng.toFixed(3)},${pref},${radius}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return json(hit.data);

    // 1) 카카오 키워드 검색 (유형별 병렬)
    const results = await Promise.all(
      QUERIES[pref].map(async ({ q, kind }) => {
        const d = await kakao("keyword.json", {
          query: q, x: center.lng, y: center.lat, radius, sort: "distance", size: 15,
        });
        return (d.documents ?? []).map((p: any) => ({
          id: p.id, name: p.place_name, kind,
          address: p.road_address_name || p.address_name,
          phone: p.phone || null, url: p.place_url,
          distanceM: Number(p.distance), lat: Number(p.y), lng: Number(p.x),
        }));
      }),
    );
    const byId = new Map<string, any>();
    for (const f of results.flat()) if (!byId.has(f.id)) byId.set(f.id, f);
    const facilities = [...byId.values()];

    // 2) 제휴 시설 정보 결합
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: partners } = await sb
      .from("partner_facilities")
      .select("*")
      .in("kakao_place_id", facilities.map((f) => f.id))
      .eq("active", true);
    const pmap = new Map((partners ?? []).map((p: any) => [p.kakao_place_id, p]));

    // 3) 적합도 순 정렬
    const ranked = facilities
      .map((f) => {
        const p = pmap.get(f.id);
        const { s, reasons } = score(f, pref, radius, p);
        return {
          ...f,
          reasons,
          partner: !!p,
          isAd: !!p?.is_ad, // UI에서 반드시 "광고·제휴" 배지로 표시
          trialInfo: p?.trial_info ?? null,
          priceInfo: p?.price_info ?? null, // 제휴 시설만 가격 제공, 그 외는 "시설에 문의"
          beginnerFriendly: !!p?.beginner_friendly,
          contactUrl: p?.contact_url ?? null,
          _s: s,
        };
      })
      .sort((a, b) => b._s - a._s)
      .slice(0, limit)
      .map(({ _s, ...rest }) => rest);

    const data = { center, pref, radius, count: ranked.length, facilities: ranked };
    cache.set(key, { at: Date.now(), data });
    return json(data);
  } catch (e) {
    console.error(e);
    return json({ error: "시설 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);
  }
});
