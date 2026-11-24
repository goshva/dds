# Stage 3.2.1 — findings по бизнес-семантике

Метрик в реестре: 11; целостность реестра: ok.

## Противоречия и неопределённости

- sum_without_bonuses: имя метрики не соответствует каталожному описанию «Сумма (ДС + баллы)» при выражении SUM(sum_paid)
- sum_with_bonuses: имя метрики не соответствует каталожному описанию «Сумма (только ДС)» при выражении SUM(sum_paid - sum_paid_disc)
- денежные метрики: единица измерения (рубли или копейки) не подтверждена
- ratio-метрики share_not_in_slot_above_all/under_all/share_delivered_taxi: числители в наборе отсутствуют
- share_orders_delivered: знаменатель — все заказы УЗ, в наборе отсутствует; значения постоянны (1.0)
- qty_orders_in_work: все значения равны нулю

## Заблокированные метрики

- qty_orders_in_work
- share_orders_delivered

## Метрики без подтверждённого определения (unconfirmed)

- qty_orders_in_work
- share_not_in_slot_above_all
- share_not_in_slot_under_all
- share_delivered_taxi
- share_orders_delivered
- sum_without_bonuses
- sum_with_bonuses

## Что требуется от бизнеса

- письменно подтвердить определение qty_orders_delivered (что именно считается доставленным заказом и какая дата используется)
- подтвердить единицы измерения денежных метрик и устранить противоречие имён sum_with_bonuses / sum_without_bonuses
- подтвердить числители и знаменатели ratio-метрик
- объяснить нулевые значения qty_orders_in_work и постоянное значение 1.0 у share_orders_delivered

