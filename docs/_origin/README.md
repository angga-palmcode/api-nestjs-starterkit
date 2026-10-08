# Origin of this kit (maintainers only)

This folder is the provenance and build log of the starter kit itself:

| File | What it is |
| :-- | :-- |
| `non-living/shared/NEST-STARTER-KIT-BLUEPRINT.md` | The original spec and the phased execution plan (Part A decisions, Part B plan) |
| `EXTRACTION-MAP.md` | The audit of the source project: what was copied, generalised or excluded, and the defects deliberately not copied |
| `PROGRESS.md` | Phase-by-phase status of the build |

It names the project the kit was extracted from, and it is only useful to people maintaining the kit.

**In a project created from this template, delete it:** `rm -rf docs/_origin`. Everything else in the repository is kit documentation and is written without reference to the source project; `grep -ri` for the source project's name, excluding this folder, must find nothing.
