-- DRAFT ONLY. НЕ ПРИМЕНЯТЬ. Этап 1.5 — проектирование.
-- Миграция 0008_mentorship
-- Назначение: Назначения наставника и оценки смен
-- Зависимости: 0004, 0001
-- Rollback: DROP новых таблиц

CREATE TABLE mentorship_assignments (
  id uuid,
  mentor_courier_id uuid NOT NULL,
  trainee_courier_id uuid NOT NULL,
  assigned_by uuid,
  starts_at timestamptz NOT NULL,
  planned_ends_at timestamptz NOT NULL,
  actual_ends_at timestamptz,
  status text DEFAULT 'ACTIVE' NOT NULL,
  completion_confirmed_by uuid,
  completion_confirmed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_mentorship_assignments PRIMARY KEY (id),
  CONSTRAINT fk_mentorship_assignments_mentor_courier_id FOREIGN KEY (mentor_courier_id) REFERENCES couriers (id),
  CONSTRAINT fk_mentorship_assignments_trainee_courier_id FOREIGN KEY (trainee_courier_id) REFERENCES couriers (id)
);

CREATE TABLE mentorship_shift_reviews (
  id uuid,
  mentorship_assignment_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  shift_number integer NOT NULL,
  delivery_quality_score numeric(14,2),
  rules_compliance_score numeric(14,2),
  review_comment text,
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL,
  CONSTRAINT pk_mentorship_shift_reviews PRIMARY KEY (id),
  CONSTRAINT fk_mentorship_shift_reviews_mentorship_assignment_id FOREIGN KEY (mentorship_assignment_id) REFERENCES mentorship_assignments (id),
  CONSTRAINT fk_mentorship_shift_reviews_shift_id FOREIGN KEY (shift_id) REFERENCES courier_shifts (id)
);

