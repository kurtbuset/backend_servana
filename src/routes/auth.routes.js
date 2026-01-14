const  express = require("express");
const {
    register,
    login,
    refresh,
    logout,
    profile,
} = require("../controllers/auth.controller");

const auth = require("../middlewares/auth.middleware");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", auth, logout);
router.get("/profile", auth, profile);

module.exports = router;