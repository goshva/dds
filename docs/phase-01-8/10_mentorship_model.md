# 10 — Mentorship Model

**Сгенерировано:** 2026-11-22T15:07:15.503Z

## 1. <ФИО>-правила наставничества

1. Куратор — наставник.
2. Сопровождение — две недели.
3. Оценка по первым пяти сменам, качеству доставки и соблюдению правил.
4. Куратор может добавлять заказы в свою группу с учётом нагрузки/доступности.
5. Жёсткого лимита стажёров нет; можно предусмотреть предупреждение.
6. Кто назначает стажёра куратору — неизвестно.
7. Критерии завершения/продления после двух недель требуют уточнения.

## 2. Сущности

| ID | Имя | Слой | Статус | Confidence | ***REMOVED*** | Grain |
| --- | --- | --- | --- | --- | --- | --- |
| ENT-HR-COURIER-STATUS | HrCourierStatus | OBSERVED_SOURCE | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | Одна строка на курьера/изменение. |
| ENT-HR-MENTORSHIP | HrMentorship | OBSERVED_SOURCE | FOUND_IN_SUPERSET_SQL | MEDIUM | KEEP | Одна строка на назначение; не подтверждено. |
| ENT-MENTORSHIP-ASSESSMENT | MentorshipAssessment | TARGET_LOGICAL | BUSINESS_REQUIRED_NOT_FOUND | NONE | NEW | Одна строка на оценку. |

## 3. Процессы

| ID | Процесс | Шаги | <ФИО> | Timestamps | Источник |
| --- | --- | --- | --- | --- | --- |
| PRC-012 | Назначение наставника и оценка обучения | Назначение наставника → Сопровождение → Оценка → Завершение | MentorAssigned, MentorshipAssessed | assigned_at, completed_at | BUSINESS_REQUIREMENT |

## 4. HR-evidence и его ограничения

`5939 hr_daily_pers_mentors` использует `agile_mart_techaudit.hr_daily_pers`,
`actual_assistant_tt`, `stage_outer_sources.fio_employee` и выводит `mentorid`,
`mentorid_at_date`, `mentor_at_date`, `mentor_in_five`, `shift_rn_trainee`,
`trainee_shift_in_five`, `trainee_shifts_qty`, `mentor_same_tt_date`.

<ФИО> реальное evidence о наставнических атрибутах в HR-аналитике. Но SQL описывает
наставничество персонала/сотрудников в розничном контуре и не доказывает, что эти
поля полностью покрывают процесс «куратор — стажёр-курьер» с двухнедельным
сопровождением.

`date_for_mentor` в SQL `5939` отсутствует — прежнее упоминание считать stale metadata.

## 5. Разделение в модели

- `HrMentorship` — наблюдаемый HR-контекст (частично прослеживается).
- `CourierMentorship` — целевая курьерская программа (требует подтверждения).
- `MentorshipAssessment` — оценка по первым пяти сменам; источник не найден.

## 6. Что нужно от HR

1. Применяются ли `mentorid_at_date` и `trainee_shift_in_five` к курьерам или к сотрудникам розницы?
2. Где хранится назначение курьера куратору и период двухнедельного сопровождения?
3. Кто утверждает завершение/продление обучения?
