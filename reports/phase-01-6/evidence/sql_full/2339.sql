SELECT *, CAST(new_value AS DATE) new_value_n, status_name_ as status_name
FROM Loyalty_srv03.dbo.Webcall_log_ui_period ('Orders_header', NULL, DATEADD(MONTH, -1, CAST(GETDATE() AS DATE)), CAST(GETDATE() AS DATE)) web
JOIN Reports.dbo.ksa_time_vw (NOLOCK) dt
ON dt.id_order = web.object_id
WHERE [type] = 'Изменение даты доставки' 
 AND prop = 'date_supply' 
 AND date_supply_2 = CAST(new_value AS DATE)
 AND (comment LIKE '%Перенос заказа на следующий день из-за невозможности доставки, комментарий%' 
 OR comment LIKE '%Смена даты доставки: Долгое ожидание сборки, комментарий%' 
 OR comment LIKE '%Смена даты доставки: Долгий поиск курьера, комментарий%' 
 OR comment LIKE '%Смена даты доставки: Разрушение Пуллинга, комментарий%' 
 OR comment LIKE '%Смена даты доставки: Дежурный не обновил поиск, комментарий%')