# dotclaude

Template Claude Code yang menyimpan semuanya **di dalam repo**: agents, skills, commands, hooks + memory, dan rules dari [ECC](https://github.com/affaan-m/ECC), ditambah [RTK](https://github.com/rtk-ai/rtk) untuk memadatkan output command. Tanpa plugin, tanpa saklar `enabledPlugins`.

## Yang dipasang ke repo target

| Path | Isi | Sumber |
| --- | --- | --- |
| `.claude/agents/` | Subagent ECC | `vendor/ecc` |
| `.claude/skills/` | Skill ECC (`SKILL.md`) | `vendor/ecc` |
| `.claude/commands/` | Slash command ECC | `vendor/ecc` |
| `.claude/rules/ecc/` | Rules umum + per bahasa (dimuat sesuai `paths`) | `vendor/ecc` |
| `.claude/hooks/`, `.claude/scripts/` | Hook ECC (gateguard, memory persistence, dll.) dan script-nya | `vendor/ecc` |
| `.claude/hooks/rtk-rewrite.sh`, `.claude/RTK.md` | Hook dan instruksi RTK | `template/` |
| `.claude/settings.json` | Registrasi semua hook + `env.ECC_HOOK_PROFILE` | digabung |
| `CLAUDE.md` | Memory proyek, mengimpor `@.claude/RTK.md` | digabung |
| `.claude/dotclaude.lock.json` | Daftar file yang dikelola + hash-nya | dibuat installer |

Memory sesi ECC (session-data, instincts) disimpan di `~/.claude` milik masing-masing user, bukan di repo.

## Prasyarat

- [Bun](https://bun.sh) untuk menjalankan installer
- Node.js, karena hook ECC berjalan dengan `node`
- `rtk` di PATH (opsional; tanpa itu command Bash jalan tanpa dipadatkan)

## Pasang

Dari repo target, pin ke tag rilis:

```bash
bunx github:adhemukhlis/dotclaude#v0.2.0
```

Opsi: `--dry-run` untuk melihat perubahan, `--force` untuk menimpa file yang diedit lokal.

Kalau sebelumnya repo memakai plugin ECC, installer otomatis menghapus `ecc@ecc` dari `enabledPlugins` (di `settings.json` dan `settings.local.json`) supaya hook tidak jalan dua kali.

## Strategi update

Update mengalir dua tahap: **ECC → repo ini → repo-repo yang memakainya.**

### 1. ECC → dotclaude

- Versi ECC dipin di `dotclaude.config.json` (`ecc.version`, `ecc.profile`, `ecc.hookProfile`).
- `bun run sync` menjalankan installer resmi ECC (`--target claude-project`) di folder sementara, menyalin hasilnya ke `vendor/ecc/`, dan mengubah hook agar portabel. Installer ECC menanam path absolut mesin ke tiap hook; sync menggantinya dengan `$CLAUDE_PROJECT_DIR/.claude`.
- Workflow [`sync-ecc.yml`](.github/workflows/sync-ecc.yml) mengecek rilis `ecc-universal` setiap Senin. Kalau ada versi baru, workflow menjalankan sync, menaikkan versi minor di `package.json`, lalu membuka PR. Bisa juga dijalankan manual dari tab Actions dengan versi tertentu.
- Review PR-nya (terutama `vendor/ecc/hooks.json`), merge, lalu buat tag:

```bash
git tag v0.3.0 && git push origin v0.3.0
```

Mengganti profil (`minimal`, `core`, `developer`, `full`): `bun run sync --profile full`.

### 2. dotclaude → repo target

Jalankan ulang installer dengan tag baru:

```bash
bunx github:adhemukhlis/dotclaude#v0.3.0
```

Installer membandingkan tiap file dengan hash di `.claude/dotclaude.lock.json`:

| Kondisi file di repo target | Tindakan |
| --- | --- |
| Belum ada | Dibuat |
| Sama dengan versi terakhir yang dipasang | Ditimpa versi baru |
| Diedit lokal | **Dibiarkan**, dengan peringatan (`--force` untuk menimpa) |
| Dihapus di upstream, tidak diedit | Dihapus |
| Dihapus di upstream, tapi diedit | Dibiarkan, dengan peringatan |
| Bukan file template (skill/agent/rule milikmu) | Tidak disentuh |

`settings.json`: hook yang dipasang versi sebelumnya diganti seluruhnya dengan hook versi baru; hook buatanmu sendiri tetap ada. Nilai lain yang sudah ada (termasuk `env.ECC_HOOK_PROFILE`) tidak ditimpa.

Commit hasilnya seperti perubahan biasa, jadi diff update ECC selalu bisa direview dan di-revert.

## Kustomisasi per repo

- **Skill/agent/rule sendiri:** taruh di `.claude/skills/<nama>/`, `.claude/agents/`, `.claude/rules/` dengan nama yang tidak bentrok dengan ECC. Installer tidak menyentuhnya.
- **Mengubah file ECC:** boleh diedit langsung; update berikutnya akan melewatinya. Untuk kembali ke versi upstream, hapus file itu lalu jalankan installer lagi.
- **Profil hook pribadi:** set `env.ECC_HOOK_PROFILE` di `.claude/settings.local.json` (`minimal`, `standard`, `strict`). Mematikan hook tertentu: `env.ECC_DISABLED_HOOKS` berisi id hook, dipisah koma.

## Struktur repo ini

```
dotclaude.config.json   versi + profil ECC yang dipin
scripts/sync-ecc.ts     vendor ECC ke vendor/ecc
vendor/ecc/             hasil sync (jangan diedit manual)
template/               file buatan sendiri: RTK, CLAUDE.md, settings dasar
index.ts                installer/updater untuk repo target
```

Repo ini juga memakai template-nya sendiri (`.claude/` di root), diperbarui dengan `bun run index.ts .`.
