# PRAC Deployment Rules

## STOP  Read before doing anything

Before starting ANY task in this repo, ask Shane to confirm:
1. What exactly needs to change
2. Which file(s) are involved
3. Which deployment target (Cloud Run only  see below)

## This repo: Pattaya-Rent-a-Car-Rebuild-
- Customer-facing booking engine + Express backend
- Deploys to **Cloud Run** (us-west1) ONLY via Cloud Build
- Push to main  Cloud Build auto-deploys
- DO NOT deploy this repo's dist to any Firebase Hosting site

## The admin CMS is a COMPLETELY DIFFERENT repo
- Repo: github.com/shaneruddle/PRAC-CMS-Site
- Hosted at: admin-pattayarentacar.web.app
- Never deploy Pattaya-Rent-a-Car-Rebuild- dist to admin-pattayarentacar hosting
