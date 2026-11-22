# 03. Анализ данных наставничества (5939)

## Факты (уровень METADATA)
- Датасет: `hr_daily_pers_mentors`, virtual, ch_10.0.112.21 (clickhousedb), schema `agile_mart_techaudit`, колонок 70, метрик 31, SQL 4301 символов.
- Физические источники: agile_mart_techaudit.actual_assistant_tt, agile_mart_techaudit.hr_daily_pers, stage_outer_sources.fio_employee.
- Ключевые поля: mentorid, mentor_at_date, mentorid_at_date, mentor_same_tt_date, enough_shifts_for_mentor, mentor_in_five, trainee_shift_in_five, trainee_shifts_qty, shift_rn_trainee, shift_rn_trainee_by_mentor, first_shift_date, last_shift_date.
- ПДн-поля (в отчёты не выгружаются): fio, mentorfio, cfo_name, cfo_name_for_pu, direct_name.
- Колонки с неопределённым типом: date_for_mentor, progul_text, pause_groups, period_from, soon_hire, TTfeature, type_tt_coalesce, age_group.

## Что проверено технически (SQL-форензика)
- mentorid и mentorfio присутствуют в метаданных и в SQL.
- Назначение наставника выводится из справочника `actual_assistant_tt` (помощник ТТ), а не из отдельной сущности назначения новичку.
- Фильтр датасета: `mentorid_at_date is not null and mentor_same_tt_date = 1` — наставник привязан к ТТ.
- `enough_shifts_for_mentor` — оконный агрегат: `count(CASE WHEN shift_rn_trainee IS NOT NULL THEN 1 END) OVER (PARTITION BY person_code, date_start_work, mentor_at_date)`, а не хранимый факт.
- `date_for_mentor` **отсутствует в SQL датасета** (0 вхождений) — устаревшая колонка метаданных, период наставничества по ней строить нельзя.
- `progul` используется как фильтр Jinja (`AND progul = 0` для категории «Прогульщиков») — семантика неоднозначна.
- `stake` выбирается напрямую из `hr_daily_pers` без вычислений; назначение (ставка/доля) не подтверждено.

## Что НЕ проверено (BLOCK-1)
Доля NULL в mentorid, число уникальных наставников и стажёров, распределение по месяцам,
число смен назначения, доля записей с progul, зерно датасета.

## Вывод
Dataset 5939 пригоден как **аналитический** источник признаков наставничества
(mentorid, mentor_in_five, trainee_shift_in_five, trainee_shifts_qty, first/last_shift_date),
но **не подтверждает** операционную сущность «назначение наставника новичку».
Таблица `mentorship_assignments` требует уточнения зерна: возможно (наставник, ТТ, период).
