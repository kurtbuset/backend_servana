const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const router = express.Router();
const supabase = require("../../helpers/supabaseClient.js");
const getCurrentMobileUser = require("../../middleware/getCurrentMobileUser.js"); // attaches req.userId
const { v4: uuidv4 } = require("uuid");

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || "your_jwt_secret_key"; // Use env var in production

const OTP_LENGTH = 6;
const OTP_EXPIRATION_MINUTES = 5;

function generateOtp(length = 6) {
  let otp = "";
  for (let i = 0; i < length; i++) otp += Math.floor(Math.random() * 10);
  return otp;
}

// Helper: generate random numeric OTP
function generateOtp(length = OTP_LENGTH) {
  let otp = "";
  for (let i = 0; i < length; i++) otp += Math.floor(Math.random() * 10);
  return otp;
}

// clientAccount/auth/send-otp
router.post("/auth/send-otp", async (req, res) => {
  // console.log('req body otp: ', req.body)
  const { phone_country_code, phone_number } = req.body;

  if (!phone_country_code || !phone_number) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  try {
    const { data: existingOtp, error: fetchError } = await supabase
      .from("otp_sms")
      .select("*")
      .eq("phone_country_code", phone_country_code)
      .eq("phone_number", phone_number)
      .eq("verified", true)
      .single();

    if (existingOtp) {
      return res.status(409).json({
        error: "An OTP has already been sent to this number. Please wait or use the existing OTP."
      });
    }

    const otp = generateOtp();
    const otp_hash = await bcrypt.hash(otp, 10);
    const expires_at = new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60 * 1000).toISOString();

    // Upsert OTP (insert new or update existing)
    const { error } = await supabase
      .from("otp_sms")
      .upsert(
        {
          otp_id: uuidv4(),
          phone_country_code,
          phone_number,
          otp_hash,
          expires_at,
          verified: false,
          attempts: 0,
        },
        { onConflict: ["phone_number"] }
      );

    if (error) throw error;

    // TODO: Replace console.log with actual SMS sending
    console.log(`OTP for ${phone_country_code}${phone_number}: ${otp}`);

    return res.status(200).json({ message: "OTP sent successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to send OTP" });
  }
});

// clientAccount/auth/verify-otp
router.post("/auth/verify-otp", async (req, res) => {
  const { phone_country_code, phone_number, otp } = req.body;

  if (!phone_country_code || !phone_number || !otp) {
    return res.status(400).json({ error: "Phone number and OTP are required" });
  }

  try {
    const { data: otpData, error: otpError } = await supabase
      .from("otp_sms")
      .select("*")
      .eq("phone_country_code", phone_country_code)
      .eq("phone_number", phone_number)
      .single();

    if (otpError || !otpData) return res.status(404).json({ error: "OTP not found" });
    if (otpData.verified) return res.status(400).json({ error: "OTP already verified" });
    if (new Date() > new Date(otpData.expires_at)) return res.status(400).json({ error: "OTP expired" });

    const isValid = await bcrypt.compare(otp, otpData.otp_hash);
    if (!isValid) {
      await supabase
        .from("otp_sms")
        .update({ attempts: otpData.attempts + 1 })
        .eq("otp_id", otpData.otp_id);
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Mark OTP as verified
    await supabase
      .from("otp_sms")
      .update({ verified: true })
      .eq("otp_id", otpData.otp_id);

    return res.status(200).json({ message: "OTP verified successfully" });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Failed to verify OTP" });
  }
});

router.post("/auth/complete-registration", async (req, res) => {
  const { phone_country_code, phone_number, firstName, lastName, birthdate, address, password } = req.body;

  if (!phone_country_code || !phone_number || !firstName || !lastName || !birthdate || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    // Check that OTP was verified
    const { data: otpData, error: otpError } = await supabase
      .from("otp_sms")
      .select("*")
      .eq("phone_country_code", phone_country_code)
      .eq("phone_number", phone_number)
      .eq("verified", true)
      .single();

    if (otpError || !otpData) return res.status(400).json({ error: "OTP not verified yet" });

    // Insert profile
    const { data: profileData, error: profileError } = await supabase
      .from("profile")
      .insert({
        prof_firstname: firstName,
        prof_lastname: lastName,
        prof_date_of_birth: birthdate,
        prof_address: address || null
      })
      .select()
      .single();

    if (profileError || !profileData) return res.status(500).json({ error: "Failed to create profile" });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert client linked to profile
    const { data: clientData, error: clientError } = await supabase
      .from("client")
      .insert({
        client_country_code: phone_country_code,
        client_number: phone_number,
        client_password: hashedPassword,
        prof_id: profileData.prof_id,
        client_updated_at: new Date().toISOString(),
        client_is_active: true,
        client_is_verified: true,
        role_id: 2
      })
      .select()
      .single();

    if (clientError || !clientData) return res.status(500).json({ error: "Failed to create client" });

    // Delete OTP
    await supabase
      .from("otp_sms")
      .delete()
      .eq("otp_id", otpData.otp_id);

    return res.status(200).json({
      message: "Account created successfully",
      client: {
        ...clientData,
        prof_id: profileData
      }
    });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Failed to complete registration" });
  }
});






// clientAccount/registercl
router.post("/registercl", async (req, res) => {
  console.log("Register request body:", req.body);

  const { client_country_code, client_number, client_password } = req.body;

  if (!client_country_code || !client_number || !client_password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const { data: existingClient, error: findError } = await supabase
    .from("client")
    .select("*")
    .eq("client_number", client_number)
    .single();

  if (existingClient) {
    return res.status(409).json({ error: "Client already exists" });
  }

  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(client_password, saltRounds);

  const { data, error } = await supabase
    .from("client")
    .insert([
      {
        client_country_code,
        client_number,
        client_password: hashedPassword,
        client_created_at: new Date().toISOString(),
        role_id: 2,
      },
    ])
    .select();

  if (error) {
    console.log("Supabase error:", error);
    return res.status(500).json({
      error: "Failed to register client",
      details: JSON.stringify(error),
    });
  }

  const client = data[0];
  const token = jwt.sign(
    { client_id: client.id, client_number: client.client_number },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return res.status(201).json({
    message: "Client registered successfully",
    client: {
      id: client.id,
      client_number: client.client_number,
      client_country_code: client.client_country_code,
    },
    token,
  });
});

// LOGIN ROUTE
router.post("/logincl", async (req, res) => {
  const { client_country_code, client_number, client_password } = req.body;

  console.log('req body: ', req.body)

  if (!client_country_code || !client_number || !client_password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  // Check if client exists
  const { data: client, error } = await supabase
    .from("client")
    .select(
      `
    *,
    prof_id (
      prof_id,
      prof_firstname,
      prof_middlename,
      prof_lastname,
      prof_address,
      prof_date_of_birth,
      prof_street_address,
      prof_region_info,
      prof_postal_code
    )
  `
    )
    .eq("client_country_code", client_country_code)
    .eq("client_number", client_number)
    .single();
  console.log("Supabase error:", error);
  console.log("Client data:", client);

  if (error || !client) {
    console.log("invalid phone number or password");
    return res.status(401).json({ error: "Invalid phone number or password" });
  }

  // Check password
  const isMatch = await bcrypt.compare(client_password, client.client_password);
  if (!isMatch) {
    console.log("Invalid password attempt for client:");
    return res.status(401).json({ error: "Invalid phone number or password" });
  }

  // Generate JWT
  const token = jwt.sign(
    { client_id: client.client_id, client_number: client.client_number },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  // Check if chat group exists for this client
  let chatGroupId = null;
  const { data: existingGroup, error: groupError } = await supabase
    .from("chat_group")
    .select("chat_group_id")
    .eq("client_id", client.client_id)
    .order("chat_group_id", { ascending: false })
    .limit(1)
    .single();

  if (existingGroup) {
    chatGroupId = existingGroup.chat_group_id;
  } else {
    // Create a new chat group with dept_id as NULL
    const { data: newGroup, error: createError } = await supabase
      .from("chat_group")
      .insert([
        {
          client_id: client.client_id,
          dept_id: null, // <-- department will be assigned later
        },
      ])
      .select("chat_group_id")
      .single();

    if (createError) {
      console.error("Error creating chat group:", createError.message);
      return res.status(500).json({ error: "Failed to create chat group" });
    }

    chatGroupId = newGroup.chat_group_id;
  }

  // Return response
  return res.status(200).json({
    message: "Login successful",
    client,
    token,
    chat_group_id: chatGroupId,
    chat_group_name: `Client ${client.client_id} Chat`,
  });
});

// PATCH: Assign department to an existing chat group and create initial message
router.patch("/chat_group/:id/set-department", async (req, res) => {
  const id = Number(req.params.id);
  const { dept_id } = req.body;

  console.log("📥 PATCH /chat_group/:id/set-department");
  console.log("chat_group_id:", id, "dept_id:", dept_id, "type:", typeof id);

  if (!dept_id) {
    return res.status(400).json({ error: "Department ID is required" });
  }

  // 1. Update chat_group table
  const { data: updatedGroup, error: updateError } = await supabase
    .from("chat_group")
    .update({ dept_id })
    .eq("chat_group_id", id)
    .select();

  if (updateError) {
    console.error("❌ Supabase error:", updateError.message);
    return res.status(500).json({ error: "Failed to assign department" });
  }

  if (!updatedGroup || updatedGroup.length === 0) {
    return res.status(404).json({ error: "Chat group not found" });
  }

  // 2. Get the department name
  const { data: dept, error: deptError } = await supabase
    .from("department")
    .select("dept_name")
    .eq("dept_id", dept_id)
    .single();

  if (deptError || !dept) {
    console.error("❌ Failed to fetch department name:", deptError?.message);
    return res.status(500).json({ error: "Failed to fetch department name" });
  }

  // 3. Insert department name as the first system message
  const { error: insertError } = await supabase.from("chat").insert([
    {
      chat_group_id: id,
      chat_body: dept.dept_name,
      sender: "system", // Ensure your DB supports this column, or remove if not needed
      chat_created_at: new Date().toISOString(),
    },
  ]);

  if (insertError) {
    console.error("❌ Failed to insert initial message:", insertError.message);
    return res.status(500).json({ error: "Failed to insert initial message" });
  }

  console.log("✅ Department assigned and initial message inserted");
  return res.status(200).json({
    message: "Department assigned successfully and message created",
    updated: updatedGroup[0],
  });
});

router.put('/:prof_id', async (req, res) => {
  const { prof_id } = req.params; // get the profile ID from the URL
  const {
    prof_firstname,
    prof_middlename,
    prof_lastname,
    prof_address,
    prof_street_address,
    prof_region_info,
    prof_postal_code,
    prof_date_of_birth
  } = req.body;

  console.log('Updating profile ID:', prof_id);
  console.log('Data:', req.body);

  // Validate required fields (optional)
  if (!prof_firstname || !prof_lastname) {
    return res.status(400).json({ message: 'First name and last name are required' });
  }

  try {
    const { data, error } = await supabase
      .from('profile') // your table name
      .update({
        prof_firstname,
        prof_middlename,
        prof_lastname,
        prof_address,
        prof_street_address,
        prof_region_info,
        prof_postal_code,
        prof_date_of_birth
      })
      .eq('prof_id', prof_id)
      .select()
      .single(); // returns the updated row

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ message: error.message });
    }

    return res.status(200).json({
      message: 'Profile updated successfully',
      profile: data
    });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post("/client", async (req, res) => {
  try {
    const { message, clientId, deptId } = req.body;

    if (!message || !clientId) {
      return res.status(400).json({ error: "Missing message or clientId" });
    }

    // Check if chat group exists for this client
    let { data: chatGroups, error: groupErr } = await supabase
      .from("chat_group")
      .select("*")
      .eq("client_id", clientId);

    if (groupErr) throw groupErr;

    let chatGroupId;
    if (!chatGroups || chatGroups.length === 0) {
      // Create new chat group
      const { data: newGroup, error: createErr } = await supabase
        .from("chat_group")
        .insert([{ client_id: clientId, dept_id: deptId }])
        .select("*")
        .single();

      if (createErr) throw createErr;
      chatGroupId = newGroup.chat_group_id;
    } else {
      chatGroupId = chatGroups[0].chat_group_id;
    }

    // Insert message
    const { data, error: insertErr } = await supabase
      .from("chat")
      .insert([
        {
          chat_group_id: chatGroupId,
          client_id: clientId,
          sys_user_id: null,
          chat_body: message,
        },
      ])
      .select("*");

    if (insertErr) throw insertErr;

    res.json({ success: true, message: data[0] });
  } catch (err) {
    console.error("❌ Error sending client message:", err);
    res.status(500).json({ error: err.message });
  }
});

// Global error handler 
router.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res
    .status(500)
    .json({ error: "Internal server error", details: String(err) });
});

// All routes below this require authentication
router.use(getCurrentMobileUser);

// You can add protected routes below here

module.exports = router;
