const express = require('express');
const cors = require('cors');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const dotenv = require('dotenv');
const morgan = require('morgan');
const path = require('path');

const postRouter = require('./routes/post');
const postsRouter = require('./routes/posts');
const userRouter = require('./routes/user');
const hashtagRouter = require('./routes/hashtag');
const db = require('./models');
const passportConfig = require('./passport');

const app = express();

dotenv.config();
db.sequelize.sync()
  .then(() => {
    console.log("db 연결 성공");
  })
  .catch(console.error);
passportConfig();
app.use(morgan('dev'));
/* get 가져오기
   post 생성하기
   put 전체 수정
   delete 제거
   patch 부분 수정
   options 찔러보기
   head 헤더만 가져오기
*/

/*front 의 정보(data)를 req 에 붙여줌 */
app.use(cors({
  origin : 'http://localhost:3060',
  credentials : true,
}));

//__dirname 현재 폴더
app.use('/',express.static(path.join(__dirname, 'uploads')));   // 경로 string 붙일때 +안쓰고 path.join을 씀 ==> 운영체제마다 파일경로(/ | \)이 다르다.
app.use(express.json());                              //json 형태의 데이터 처리 (axios)
app.use(express.urlencoded({ extended: true}));  //form submit시에 데이터 처리
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(session({
  saveUninitialized : false,
  resave : false,
  secret : process.env.COOKIE_SECRET,
}));
app.use(passport.initialize());
app.use(passport.session());

/*  req | res
  헤더 ==> 상태, 용량, 시간,쿠키
  바디 ==> 데이터
 */
app.get('/', (req,res) =>{
  res.send('hello express');
});


app.use('/posts',postsRouter);
app.use('/post',postRouter);
app.use('/user',userRouter);
app.use('/hashtag',hashtagRouter);

/*error 처리 미들웨어 사용자 정의 하기
app.use((err, req, res, next) => {

});
*/

app.listen(3065, () => {
  console.log('서버 실행중');
});