const axios = require('axios');
const kakaoService = require('../services/kakaoService');
const pool = require('../../../config/database');
const jwtUtil = require('../utils/jwt');
const response = require('../utils/response');

const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const KAKAO_USER_INFO_URL = 'https://kapi.kakao.com/v2/user/me';
const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID;
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI;
const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET;

// 카카오 로그인 처리
exports.kakaoLogin = async (req, res) => {
    const { code } = req.body; // 클라이언트에서 받은 Kakao 인가 코드
    if (!code) {
        return response.error(res, 'Authorization code is required', 400);
    }

    try {
        // 인가 코드를 액세스 토큰으로 교환
        const tokenResponse = await axios.post(KAKAO_TOKEN_URL, null, {
            params: {
                grant_type: 'authorization_code',
                client_id: KAKAO_CLIENT_ID,
                redirect_uri: KAKAO_REDIRECT_URI,
                code: code,
                client_secret: KAKAO_CLIENT_SECRET,
            },
        });

        const { access_token } = tokenResponse.data;

        // 액세스 토큰을 사용하여 카카오 사용자 정보 가져오기
        const kakaoUserResponse = await axios.get(KAKAO_USER_INFO_URL, {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });

        const kakaoUser = kakaoUserResponse.data;
        const email = kakaoUser.kakao_account.email;
        const name = kakaoUser.properties.nickname;
        let isExistingUser = false;

        // DB에서 사용자 확인
        const [rows] = await pool.query('SELECT * FROM members WHERE email = ?', [email]);

        let user;
        if (rows.length) {
            // 기존 회원
            user = rows[0];
            isExistingUser = true;
        } else {
            // 신규 회원 등록
            const [result] = await pool.query(
                'INSERT INTO members (email, name) VALUES (?, ?)',
                [email, name]
            );
            user = { id: result.insertId, email, name };
        }

        // JWT 발급
        const token = jwtUtil.generateToken({ id: user.id, email: user.email });

        // 성공 응답
        return response.success(res, 'Login successful', {
            token,
            email: user.email,
            name: user.name,
            isExistingUser: isExistingUser
        });
    } catch (error) {
        console.error('Error during Kakao login:', error);
        return response.error(res, 'Failed to log in with Kakao', 500);
    }
};

// 회원 이름 및 생일 정보 반환
exports.getUserNameAndBirthday = async (req, res) => {
    const userId = req.user.id; // JWT에서 인증된 사용자 ID

    try {
        // members 테이블에서 사용자 정보 조회
        const [rows2] = await pool.query('SELECT name, birth_date FROM members WHERE id = ?', [userId]);

        if (!rows2.length) {
            return response.error(res, 'User not found', 404);
        }

        const user = rows2[0];

        // 생일 형식 변환 (YYYY-MM-DD -> @월 @일)
        let formattedBirthday = null;
        let isBirthday = false;
        if (user.birth_date) {
            const birthDate = new Date(user.birth_date);
            const month = birthDate.getMonth() + 1; // 월 (0부터 시작하므로 +1)
            const day = birthDate.getDate(); // 일
            formattedBirthday = `${month}월 ${day}일`;

            // 오늘 날짜와 비교하여 생일 여부 확인
            const today = new Date();
            if (today.getMonth() + 1 === month && today.getDate() === day) {
                isBirthday = true;
            }
        }

        // 응답 데이터
        return response.success(res, 'User information fetched successfully', {
            name: user.name,
            birthday: formattedBirthday,
            isBirthday
        });
    } catch (error) {
        console.error('Error fetching user name and birthday:', error);
        return response.error(res, 'Failed to fetch user information', 500);
    }
};

// 사용자 프로필 정보 가져오기
exports.getUserProfile = async (req, res) => {
    const userId = req.user.id; // JWT에서 인증된 사용자 ID

    try {
        const [rows] = await pool.query('SELECT name, email FROM members WHERE id = ?', [userId]);

        if (!rows.length) {
            return response.error(res, 'User not found', 404);
        }

        const user = rows[0];
        return response.success(res, 'User profile fetched successfully', user);
    } catch (error) {
        console.error('Error fetching user profile:', error);
        return response.error(res, 'Failed to fetch user profile', 500);
    }
};

// 사용자 프로필 업데이트
exports.updateUserProfile = async (req, res) => {
    const userId = req.user.id; // JWT에서 인증된 사용자 ID
    const { name, email, birth_date } = req.body;

    // 입력 검증: 최소 하나의 필드가 있어야 함
    if (!name && !email && !birth_date) {
        return response.error(res, 'At least one field (name, email, birth_date) is required', 400);
    }

    try {
        // members 테이블 업데이트 (필드가 전달된 경우에만 수정)
        const fieldsToUpdate = [];
        const values = [];

        if (name) {
            fieldsToUpdate.push('name = ?');
            values.push(name);
        }
        if (email) {
            fieldsToUpdate.push('email = ?');
            values.push(email);
        }
        if (birth_date) {
            fieldsToUpdate.push('birth_date = ?');
            values.push(birth_date);
        }

        values.push(userId);

        const query = `UPDATE members SET ${fieldsToUpdate.join(', ')} WHERE id = ?`;
        await pool.query(query, values);

        return response.success(res, 'User profile updated successfully');
    } catch (error) {
        console.error('Error updating user profile:', error);
        return response.error(res, 'Failed to update user profile', 500);
    }
};

// 로그아웃 처리
exports.logout = async (req, res) => {
    try {
        // 클라이언트 측에서 JWT 토큰을 삭제하도록 안내
        return response.success(res, 'Logout successful');
    } catch (error) {
        console.error('Error during logout:', error);
        return response.error(res, 'Failed to log out', 500);
    }
};