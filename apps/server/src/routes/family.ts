import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { createRepo } from '../db/repo.js';
import { nowISO, parseBody, paramString, wrap } from './_helpers.js';

export const familyRouter = Router();

// ─── List members of the current user's family ───────────────────────

familyRouter.get(
  '/members',
  wrap((req, res) => {
    if (req.familyRole !== 'owner') {
      // Members can see who else is in their family (for context).
      const repo = createRepo(getDb());
      res.json({
        role: 'member',
        ownerUserId: req.dataUserId,
        members: repo.listFamilyMembers(req.dataUserId!),
      });
      return;
    }
    const repo = createRepo(getDb());
    res.json({
      role: 'owner',
      ownerUserId: req.userId,
      members: repo.listFamilyMembers(req.userId!),
    });
  }),
);

// ─── Add an invite (owner-only) ──────────────────────────────────────

const AddSchema = z.object({
  // Lenient — the source of truth is Google's verified email on login.
  // Zod's strict .email() rejects test addresses like 'bob@test' without
  // a TLD, which is unhelpfully strict. We only require shape "x@y".
  email: z
    .string()
    .trim()
    .min(3)
    .regex(/^[^@\s]+@[^@\s]+$/i, 'Enter an email like name@example.com'),
});

familyRouter.post(
  '/members',
  wrap((req, res) => {
    if (req.familyRole !== 'owner') {
      res.status(403).json({
        error:
          "You're a member of someone else's family. Leave the family before adding your own members.",
      });
      return;
    }
    const body = parseBody(AddSchema, req, res);
    if (!body) return;

    const repo = createRepo(getDb());
    try {
      repo.insertFamilyMember({
        ownerUserId: req.userId!,
        memberEmail: body.email,
        now: nowISO(),
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'self-invite') {
        res.status(409).json({ error: 'You cannot invite your own email.' });
        return;
      }
      // SQLite UNIQUE collision — email already in another family.
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint/i.test(msg)) {
        res.status(409).json({
          error: 'That email is already a member of another family.',
        });
        return;
      }
      throw err;
    }
    res.status(201).json({
      members: repo.listFamilyMembers(req.userId!),
    });
  }),
);

// ─── Remove an invite (owner-only) ───────────────────────────────────

familyRouter.delete(
  '/members/:email',
  wrap((req, res) => {
    if (req.familyRole !== 'owner') {
      res.status(403).json({ error: 'Members cannot manage other members.' });
      return;
    }
    const email = decodeURIComponent(paramString(req.params.email));
    const repo = createRepo(getDb());
    const ok = repo.deleteFamilyMember({ ownerUserId: req.userId!, memberEmail: email });
    if (!ok) {
      res.status(404).json({ error: 'Member not found in your family.' });
      return;
    }
    res.json({ members: repo.listFamilyMembers(req.userId!) });
  }),
);

// ─── Member leaves the family they're in ─────────────────────────────

familyRouter.delete(
  '/membership',
  wrap((req, res) => {
    if (req.familyRole !== 'member') {
      res.status(409).json({ error: "You're not a member of any family." });
      return;
    }
    const repo = createRepo(getDb());
    repo.leaveFamily(req.userId!);
    res.json({ ok: true });
  }),
);
