DO $$
DECLARE h1 uuid := gen_random_uuid(); h2 uuid := gen_random_uuid(); m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid(); m3 uuid := gen_random_uuid();
        s uuid; i int;
BEGIN
  INSERT INTO users (id,email,password_hash,name,role,verified_tier) VALUES
   (h1,'h1@example.com','x','테스트','counselor','email'),(h2,'h2@example.com','x','테스트','counselor','email'),
   (m1,'m1@example.com','x','테스트','client','email'),(m2,'m2@example.com','x','테스트','client','email'),(m3,'m3@example.com','x','테스트','client','email');
  -- clinical 1:1 with m1 x3 (h1)
  FOR i IN 1..3 LOOP
    s := gen_random_uuid();
    INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,participant_mode) VALUES (s,'clinical','completed',h1,50,10,'one_on_one');
    INSERT INTO session_participants (id,session_id,user_id,band_connected,consent_audio,consent_eeg) VALUES (gen_random_uuid(),s,m1,false,false,false);
  END LOOP;
  -- clinical 1:1 with m2 (h1) and with m2 (h2)
  s := gen_random_uuid(); INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,participant_mode) VALUES (s,'clinical','completed',h1,50,10,'one_on_one');
  INSERT INTO session_participants (id,session_id,user_id,band_connected,consent_audio,consent_eeg) VALUES (gen_random_uuid(),s,m2,false,false,false);
  s := gen_random_uuid(); INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,participant_mode) VALUES (s,'hypnosis','completed',h2,50,10,'one_on_one');
  INSERT INTO session_participants (id,session_id,user_id,band_connected,consent_audio,consent_eeg) VALUES (gen_random_uuid(),s,m2,false,false,false);
  -- hypnosis group with one active participant m3 + a removed one (m1) + host row
  s := gen_random_uuid(); INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,participant_mode) VALUES (s,'hypnosis','completed',h2,50,10,'group');
  INSERT INTO session_participants (id,session_id,user_id,band_connected,consent_audio,consent_eeg) VALUES (gen_random_uuid(),s,m3,false,false,false);
  INSERT INTO session_participants (id,session_id,user_id,band_connected,consent_audio,consent_eeg,removed_at) VALUES (gen_random_uuid(),s,m1,false,false,false,now());
  INSERT INTO session_participants (id,session_id,user_id,band_connected,consent_audio,consent_eeg) VALUES (gen_random_uuid(),s,h2,false,false,false);
  -- clinical with guest only
  s := gen_random_uuid(); INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,participant_mode) VALUES (s,'clinical','completed',h1,50,10,'one_on_one');
  INSERT INTO session_participants (id,session_id,user_id,guest_name,band_connected,consent_audio,consent_eeg,report_email) VALUES (gen_random_uuid(),s,NULL,'테스트',false,false,false,'g@example.com');
  -- clinical zero participants
  s := gen_random_uuid(); INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,participant_mode) VALUES (s,'clinical','cancelled',h1,50,10,'one_on_one');
  -- meditation group 3 members + 1 guest
  s := gen_random_uuid(); INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,participant_mode,hidden_at) VALUES (s,'meditation','completed',h1,30,10,'group',now());
  INSERT INTO session_participants (id,session_id,user_id,band_connected,consent_audio,consent_eeg) VALUES (gen_random_uuid(),s,m1,false,false,false),(gen_random_uuid(),s,m2,false,false,false),(gen_random_uuid(),s,m3,false,false,false);
  INSERT INTO session_participants (id,session_id,user_id,guest_name,band_connected,consent_audio,consent_eeg) VALUES (gen_random_uuid(),s,NULL,'테스트',false,false,false);
  -- custom: 감정 코칭 1:1 with m1 / 요가 수업 group w/ 2 / 기타 1:1 none
  s := gen_random_uuid(); INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,participant_mode,custom_type_name) VALUES (s,'custom','completed',h1,30,1,'one_on_one','감정 코칭');
  INSERT INTO session_participants (id,session_id,user_id,band_connected,consent_audio,consent_eeg) VALUES (gen_random_uuid(),s,m1,false,false,false);
  s := gen_random_uuid(); INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,participant_mode,custom_type_name) VALUES (s,'custom','completed',h1,30,10,'group','요가 상담 모임');
  INSERT INTO session_participants (id,session_id,user_id,band_connected,consent_audio,consent_eeg) VALUES (gen_random_uuid(),s,m1,false,false,false),(gen_random_uuid(),s,m2,false,false,false);
  s := gen_random_uuid(); INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,participant_mode,custom_type_name) VALUES (s,'custom','scheduled',h2,30,10,'one_on_one','워크숍');
  -- template
  INSERT INTO sessions (id,type,status,host_id,duration_min,max_participants,is_template) VALUES (gen_random_uuid(),'meditation','ready',h1,30,10,true);
  -- reports
  INSERT INTO reports (id,session_id,user_id,type,status,is_read,content) SELECT gen_random_uuid(), s, m1, 'client', 'pending_review', false, '{}'::jsonb;
END $$;
