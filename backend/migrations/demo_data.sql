-- Demo data for Anamnesis

INSERT INTO patient (id, name) VALUES (1, 'Иванов Иван Иванович');

INSERT INTO specialists (id, patient_id, full_name, specialization, clinic, notes) VALUES
(1, 1, 'Петров Пётр Петрович', 'Педиатр', 'Демо-клиника', 'Демонстрационный специалист.');

INSERT INTO timeline (id, patient_id, event_date, title, description, category, specialist_name, specialist_type) VALUES
(1, 1, '2024-11-10', 'Профилактический осмотр (пример)', 'Демонстрационный визит. Ребёнок здоров, рекомендован повторный осмотр через год.', 'visit', 'Петров П.П.', 'Педиатр');

INSERT INTO diagnoses (patient_id, name, icd_code, status, detail) VALUES
(1, 'ОРВИ (пример)', 'J06.9', 'closed', 'Пример закрытого диагноза.');

INSERT INTO medications (patient_id, name, dosage, frequency, status, detail) VALUES
(1, 'Парацетамол (пример)', '250 мг', 'при температуре > 38', 'active', 'Демонстрационный препарат.');

INSERT INTO plan (patient_id, title, detail, priority, status, due_date) VALUES
(1, 'Повторный осмотр через год', 'Плановый профилактический осмотр у педиатра.', 'medium', 'pending', '2025-11-10');

INSERT INTO reminders (patient_id, title, remind_at, status) VALUES
(1, 'Плановый осмотр', '2026-11-10 09:00:00', 'pending');

INSERT INTO vaccinations (patient_id, name, vaccine_name, dose_number, scheduled_date, status) VALUES
(1, 'АКДС (пример)', 'Инфанрикс', 1, '2024-12-01', 'done'),
(1, 'Гепатит B (пример)', 'Энджерикс', 2, '2025-01-15', 'scheduled');

INSERT INTO growth_log (patient_id, measured_at, height_cm, weight_kg) VALUES
(1, '2024-11-10', 110, 20.0),
(1, '2024-05-10', 105, 18.5);

INSERT INTO lab_results (patient_id, test_date, test_name, parameter, value, unit, ref_min, ref_max, status) VALUES
(1, '2024-11-10', 'Общий анализ крови', 'Гемоглобин', 125, 'г/л', 110, 140, 'normal'),
(1, '2024-11-10', 'Общий анализ крови', 'Лейкоциты', 11.5, '10^9/л', 4.5, 10.0, 'high');
