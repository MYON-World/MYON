# MYON 월드 리온 R0 (DEV only)
- DEV discovery: World → Mission → Myonite → Mining. LIVE and TEST remain on pinned archives.
- **First discovery creates an empty world (0 sites)**. No unrequested automatic site spawning.
- Choose the wanted type among Mining, Refining, Industry, Logistics, Residential, Commerce. Each search finds 0, 1, 2, or 3 sites of exactly that type (provisional odds: 20/50/23/7%). Search failure doesn't mutate the save.
- Each found site gets `SITE-000001` onwards, a deterministic fixed hidden position and calculable distance from every other found site. There is no visible map or construction.
- **One-time site reset:** DEV v0.14.7.1 legacy world R0 schemas 1 and 2 are migrated to schema 3 and reset to zero sites (`baseCount:0,discoveredCount:0,batches:[]`). No old site ID/type/distance records remain in the new game world. World seed and createdAt are retained for continuity. Schema 3 does not reset again on reload.
- Existing DEV cash, missions, Rion discovery, mining and other fields remain unchanged during world-site migration; an intact pre-update key is retained for rollback. The version epoch transition to 0.14.8 doesn't purge DEV data.
- World R0 is created only after World Rion is discovered. A newly created World R0 starts empty. Empty site list and absence of a reference site are safe UI states.
- The existing DEV localStorage save mechanism and entry backups are used; file-picker-based external save/load is not added here.
- No ore stock regeneration, production, efficiency upgrades, real transport or economy integration in R0.
