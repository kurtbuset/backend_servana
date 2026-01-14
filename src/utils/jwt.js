const jwt = require("jsonwebtoken");
const {
    jwtAccessSecret,
    jwtRefreshSecret,
    accessTokenExpiry,
    refreshTokenExpiry,
} = require('../config');

exports.generateAccessToken = (payload) => {
    return jwt.sign(payload, jwtAccessSecret, { expiresIn: accessTokenExpiry });
};

exports.generateRefreshToken = (payload) => {
    return jwt.sign(payload, jwtRefreshSecret, { expiresIn: refreshTokenExpiry });
};

exports.verifyAccessToken = (token) => {
    return jwt.verify(token, jwtAccessSecret);
};

exports.verifyRefreshToken = (token) => {
    return jwt.verify(token, jwtRefreshSecret);
};
