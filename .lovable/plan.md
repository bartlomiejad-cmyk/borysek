## Cel
Wyeliminować błąd `AI gateway error 400: Received 404 status code when fetching image from URL: …` przez sprawdzenie dostępności URL-i zdjęć PRZED wysłaniem ich do Gemini Vision. Martwe URL-e (np. wygasłe listingi z goodpack.eu) mają być filtrowane i cache'owane, żeby nie próbować ich znowu.

## Zakres zmian

### 1. Nowy helper `src/lib/pim/image-probe.server.ts`
- `probeImageUrls(urls: string[], opts?: { timeoutMs?: number, concurrency?: number }): Promise<{ alive: string[]; dead: string[] }>`
- Równoległy `fetch(url, { method: "HEAD", redirect: "follow", signal })` z limitem ~8 jednoczesnych żądań i timeoutem 4s per URL.
- Traktuje jako "dead": status ≥400, network error, timeout. Traktuje jako "alive": status 2xx/3xx.
- Fallback: jeżeli HEAD zwraca 405 (Method Not Allowed — niektóre CDN-y), retry `GET` z `Range: bytes=0-0`.
- Zwraca zachowując kolejność wejścia (dla `alive`).

### 2. Cache martwych URL-i w `enrichments.image_scores`
Rozszerzamy istniejący `ImageScore` o pole `dead?: boolean` (obok `identity_v`, `manual_keep`). Gdy pre-flight wykryje 404, zapisujemy `{ dead: true, scored_at }` w `image_scores[url]`. Następne wywołania czytają cache i pomijają URL bez ponownego HEAD.

### 3. Punkty integracji w `src/lib/pim/ai.functions.ts`
Wszystkie miejsca składające `image_url` do `callGatewayRaw` / `scoreOneImage` przechodzą przez `filterAliveImages(supabase, enrichmentId, urls)`:
- `Object.enrichment` (linia ~610) — **źródło zgłoszonego błędu**. `images` (max 6) → pre-flight → tylko `alive` trafia do promptu.
- `analyzeProductImages` / `scoreOneImage` — pomija znane martwe URL-e z cache, resztę probuje HEAD-em przed wysłaniem do modelu; wyniki zapisuje do `image_scores`.
- Enrichment na URL-ach źródłowych w `generateGoldenRecord` (URL-e stron, nie zdjęć) — **poza zakresem**, tam odpowiada za to firecrawl.

### 4. UI — subtelna informacja
W widoku produktu (`projects.$id.products.$pid.tsx`) w sekcji galerii/„Niepewne — do weryfikacji" dodać dyskretny badge `martwy link (404)` dla URL-i oznaczonych `dead: true`, aby użytkownik widział czemu zniknęły z analizy. Ukryte z głównej galerii tak jak inne odrzucone.

## Poza zakresem (do decyzji później)
- Automatyczne wywalanie martwych URL-i z `product_sources.images` / `enrichments.picked_urls` — na razie tylko oznaczamy w cache i pomijamy. Chodzi o to, żeby nie kasować historii scrapingu przy chwilowym problemie sieciowym.
- Retry przy `type: "upstream_error"` z gateway (kierunek 2 z pierwotnej analizy) — pre-flight powinien wystarczyć.

## Weryfikacja
1. `invoke-server-function` dla enrichmentu na produkcie `721de00f-…` (ten z błędu).
2. `server-function-logs` — sprawdzić log `[image-probe] dead: goodpack.eu/…` i brak błędu 400 z gateway.
3. Ręczny test w UI: „Analizuj zdjęcia" → nie powinno się wywalać na produktach z wygasłymi linkami.

## Szczegóły techniczne
- HEAD po stronie Workera Cloudflare działa (fetch global), nie wymaga node polyfills.
- Concurrency ograniczamy prostym semaforem (`Promise.all` z partycjonowaniem po 8), bez dodatkowych zależności.
- `image-probe.server.ts` z suffiksem `.server.ts` — nie wchodzi do bundla klienta.
