"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.corsConfig = void 0;
const cors_1 = __importDefault(require("cors"));
exports.corsConfig = (0, cors_1.default)({
    origin: ((_a = process.env.ALLOWED_ORIGINS) === null || _a === void 0 ? void 0 : _a.split(',')) || ['https://bosabastard.com'],
    methods: ['GET'],
    credentials: true,
    maxAge: 86400, // 24 hours
});
