with 
pu_tt AS ( 
 SELECT id_tt, pu_name
 FROM (
 SELECT id_tt, pu_name,
 ROW_NUMBER() OVER (PARTITION BY id_tt ORDER BY event_date::date DESC) rn
 FROM "agile_mart_techaudit".actual_assistant_tt
 ) act
 WHERE rn = 1)

, cfo_pu as ( 
 select pu_code, cfo_name
 from ( select 
 pu_code,cfo_name, 
 row_number() over (partition by pu_code order by cnt_gr desc) as rn
 from (select pu_code,cfo_name, count(*) cnt_gr
 from "agile_mart_techaudit".actual_assistant_tt
 group by pu_code,cfo_name 
 )act
 )t where rn = 1) 

SELECT 
event_date
, "date"
, event_type
, hdp.person_code as person_code 
, employee_code
, hdp.fio as fio
, date_start_work
, position_name
, quantity
, stake
, date_dismissed
, uvol
, days_in_month
, exp_months
, exp_days
, experience_txt
, exp_years_months
, hdp.sex as sex
, age
, hdp."role" as role
, fe.fio as pu_name
, hdp.pu_code as pu_code
, pu_tt.pu_name as pu_name_for_tt 
, hdp.cfo_name as cfo_name
, cfo_pu.cfo_name as cfo_name_for_pu
, direct_name
, hdp.id_tt
, tt_name
, "num_ТТ"
, "type_ТТ"
, region_name
, city_name
, status_bir
, bir_flag
, progul
, is_service_position
, shortterm_flg
, under18_flag
, mentorid 
, mentorfio 
, mentorid_at_date 
, mentor_at_date 
, mentor_in_five
, shift_rn_trainee
, trainee_shift_in_five
, trainee_shifts_qty
, pu_feature_day
, pu_feature_week
, pu_feature_month
, last_shift_date
, first_shift_date
, shifts_qty
, shift_rn
, second_hire
, pause_months
, pause_days
, no_pause
, pu_position
, mentor_same_tt_date
, tt_cluster
, count (CASE WHEN shift_rn_trainee IS NOT NULL THEN 1 END) over (partition by hdp.person_code, date_start_work, mentor_at_date) as enough_shifts_for_mentor
, sum (case WHEN shift_rn_trainee IS NOT null THEN 1 END) 
over (partition by hdp.person_code, date_start_work, mentor_at_date order by date
rows between unbounded preceding and current row) as shift_rn_trainee_by_mentor
from "agile_mart_techaudit".hr_daily_pers hdp
left join pu_tt on hdp.id_tt = pu_tt.id_tt 
left join cfo_pu on hdp.pu_code = cfo_pu.pu_code
left join "stage_outer_sources".fio_employee fe on hdp.pu_code = fe.person_code 
where 
date_start_work >='2024-05-01'
and (pause_months is null or pause_months>=2)
and mentorid_at_date is not null
and mentor_same_tt_date =1

{% if from_dttm %}
and date >= toDate('{{ from_dttm }}')
and date <= toDate('{{ to_dttm }}')
{% endif %} 

{% if (filter_values('pu_name')) %} 
and fe.fio in {{ filter_values('pu_name',remove_filter=True)|where_in }}
{% endif %}

{% if (filter_values('cfo_name')) %} 
and hdp.cfo_name in {{ filter_values('cfo_name',remove_filter=True)|where_in }}
{% endif %}

{% if (filter_values('direct_name')) %} 
and direct_name in {{ filter_values('direct_name',remove_filter=True)|where_in }}
{% endif %}

{% if (filter_values('region_name')) %} 
and region_name in {{ filter_values('region_name',remove_filter=True)|where_in }}
{% endif %}

{% if (filter_values('position_name')) %} 
and position_name in {{ filter_values('position_name',remove_filter=True)|where_in }}
{% endif %}

{% for filter in get_filters('prop', remove_filter=True) %}
 {% for val in filter.get('val') %}
 {% if val == 'БИР (декретный отпуск)' %}
 AND bir_flag != 1
 {% elif val == 'Долгие больничные и невыясненные отсутствия' %}
 AND bir_flag != 2 
 {% elif val == 'В учебном отпуске' %}
 AND bir_flag != 3 
 {% elif val == 'Несовершеннолетних' %}
 AND under18_flag = 0
 {% elif val == 'Прогульщиков' %} 
 AND progul = 0
 {% elif val == 'Сезонных сотрудников' %} 
 AND shortterm_flg = 0
 {% endif %}
 {% endfor %}
{% endfor %}