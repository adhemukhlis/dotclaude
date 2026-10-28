# dotclaude

Template Claude Code siap pakai: plugin [ECC](https://github.com/affaan-m/ECC) + [RTK](https://github.com/rtk-ai/rtk) untuk memadatkan output command sehingga hemat token.

## Isi template

| File | Fungsi |
| --- | --- |
| `.claude/settings.json` | Mendaftarkan marketplace ECC, mengaktifkan `ecc@ecc`, dan memasang hook RTK di `PreToolUse:Bash` |
| `.claude/hooks/rtk-rewrite.sh` | Menjalankan `rtk hook claude`; kalau `rtk` tidak terpasang, command dibiarkan apa adanya |
| `.claude/RTK.md` | Instruksi untuk Claude cara membaca output yang sudah dipadatkan |
| `CLAUDE.md` | Mengimpor `@.claude/RTK.md` |

## Prasyarat

- [Bun](https://bun.sh)
- `rtk` di PATH (opsional bagi kolaborator; tanpa itu hook tidak melakukan apa-apa)

## Pasang ke repo lain

Dari repo target:

```bash
bunx github:adhemukhlis/dotclaude
```

Atau dari clone repo ini:

```bash
bun run index.ts ../repo-lain
```

Opsi:

- `--local` — tulis ke `.claude/settings.local.json` dan `CLAUDE.local.md` (pribadi, tidak di-commit)
- `--hooks off|minimal|standard|strict` — sekalian menjalankan `ecc setup` untuk menyimpan profil hook ECC pribadimu (disimpan di user settings, bukan di repo)
- `--dry-run` — lihat perubahan tanpa menulis apa pun

Installer aman dijalankan berulang kali:

- `settings.json` di-merge: nilai yang sudah ada selalu dipertahankan, hook baru hanya ditambahkan kalau command-nya belum terdaftar.
- `CLAUDE.md` yang sudah ada hanya ditambah baris `@.claude/RTK.md` di paling atas.
- `RTK.md` dan `rtk-rewrite.sh` selalu disamakan dengan versi template.

Setelah itu restart Claude Code atau jalankan `/reload-plugins` di repo target. Kolaborator yang membuka repo akan diminta memasang plugin ECC dari marketplace.

## Mengubah template

Edit file di `template/`, lalu jalankan ulang installer di repo yang memakainya.
