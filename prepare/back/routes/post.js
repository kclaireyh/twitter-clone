const express = require('express');
const multer = require('multer');
const path = require('path');   //node 제공
const fs = require('fs')  //filesystem
const multerS3 = require('multer-s3');
const AWS = require('aws-sdk');

const { Post, User, Comment, Image, Hashtag } = require('../models');
const { isLoggedIn } = require('./middlewares');

const router = express.Router();

/*이미지 업로드 폴더 생성*/
try{
  fs.accessSync('uploads');
}catch (error){
  console.log('uploads 폴더가 없으므로 생성합니다.');
  fs.mkdirSync('uploads');
}

AWS.config.update({
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey : process.env.S3_SECRET_ACCESS_KEY,
  region :'ap-northeast-2',
});

/*이미지 업로드*/
const upload = multer({
  /*storage : multer.diskStorage({
    destination(req, file, done){
      done(null, 'uploads');
    },
    filename(req, file, done){    // 의성.png
      const ext = path.extname(file.originalname); // 확장자 추출   (.png)
      const basename = path.basename(file.originalname, ext)  //파일 이름  (의성)
      done(null, basename +'_'+ new Date().getTime() + ext);    //의성20151545.png
    },
  }),*/
  storage: multerS3({
    s3: new AWS.S3(),
    bucket: 'react-nodebird-gowoonsori',
    key(req, file, cb) {
      cb(null, `original/${Date.now()}_${path.basename(file.originalname)}`)
    }
  }),
  limits : { fileSize : 20 * 1024 * 1024 },  //20MB
});

/*게시글 작성*/
router.post('/', isLoggedIn, upload.none(), async (req,res,next) =>{
  try{
    const hashtags =  req.body.content.match(/(#[^\s#]+)/g);
    const post = await Post.create({
      content : req.body.content,
      UserId : req.user.id,
    });
    if(hashtags){
      const result = await Promise.all(hashtags.map((tag) => Hashtag.findOrCreate({
        where : {name : tag.slice(1).toLowerCase() }
      })));
      await post.addHashtags(result.map((v) => v[0]));
    }
    if(req.body.image){
      if(Array.isArray(req.body.image)){   //이미지 여러개 올리면 iamge : [제로초.png, 부기초.png] 배열형태
        const images = await Promise.all(req.body.image.map((image) => Image.create({ src : image })));
        await post.addImages(images);
      }else{                              //이미지 한개 올리면 image: 제로초.png
        const image = await Image.create({src : req.body.image});
        await post.addImages(image);
      }
    }
    const fullPost =  await Post.findOne({
      where : {id : post.id},
      include : [{
        model: Image,
      }, {
        model : Comment,
        include : [{
          model : User,                   //댓글 작성자
          attributes : ['id' , 'nickname'],

        }],
      }, {
        model : User,                    //게시글 작성자
        attributes : ['id' , 'nickname'],
      },{
          model : User,                 //좋아요 한사람
          as : 'Likers',
          attributes : ['id'],
      }]
    },)
    res.status(201).json(fullPost);
  }catch (error){
    console.log(error);
    next(error);
  }
});

// upload 속성 : array, none, single, fields
router.post('/images', isLoggedIn, upload.array('image'), async  (req, res) => {
  console.log(req.files);
  //res.json(req.files.map((v) => v.filename));   //localfile
  res.json(req.files.map((v) => v.location.replace(/\/original\//, '/thumb/')));   //s3
});


/*댓글 작성*/
router.post('/:postId/comment', isLoggedIn, async (req,res,next) =>{
  try{
    const post = await Post.findOne({
      where : {id : req.params.postId }
    });
    if(!post){
      return res.status(403).send('존재하지 않는 게시글입니다.');
    }

    const comment = await Comment.create({
      content : req.body.content,
      PostId : parseInt(req.params.postId,10),
      UserId : req.user.id,
    });
    const fullComment = await Comment.findOne({
      where: { id: comment.id },
      include: [{
        model: User,
        attributes: ['id', 'nickname'],
      }],
    })
    res.status(201).json(fullComment);
  }catch (error){
    console.log(error);
    next(error);
  }
});

/*리트윗*/
router.post('/:postId/retweet', isLoggedIn, async (req,res,next) =>{
  try{
    const post = await Post.findOne({
      where : {id : req.params.postId },
      include :[{
        model : Post,
        as : 'Retweet',
      }],
    });
    if(!post){
      return res.status(403).send('존재하지 않는 게시글입니다.');
    }
    if(req.user.id === post.UserId || (post.Retweet && post.Retweet.UserId === req.user.id)){
      return res.status(403).send('자신의 글은 리트윗할 수 없습니다.');
    }
    const retweetTargetId = post.RetweetId || post.id;
    const exPost = await Post.findOne({
      where : {
        UserId : req.user.id,
        RetweetId : retweetTargetId,
      },
    });
    if( exPost ){
      return res.status(403).send('이미 리트윗했습니다.');
    }
    const retweet = await Post.create({
      UserId : req.user.id,
      RetweetId: retweetTargetId,
      content : 'retweet',
    });
    const retweetWithPrevPost = await Post.findOne({
      where : {id : retweet.id},
      include : [{
        model : Post,
        as : 'Retweet',
        include : [{
          model : User,
          attributes : ['id', 'nickname'],
        },{
          model : Image,
        }]
      },{
        model : User,
        attributes : ['id', 'nickname'],
      },{
        model: User, // 좋아요 누른 사람
        as: 'Likers',
        attributes: ['id'],
      },{
        model : Image,
      },{
        model : Comment,
        include : [{
          model : User,
          attributes : ['id', 'nickname'],
        }],
      }],
    })
    res.status(201).json(retweetWithPrevPost);
  }catch (error){
    console.log(error);
    next(error);
  }
});

/*좋아요  */
router.patch('/:postId/like', isLoggedIn ,async (req,res,next) => {
  try{
    const post = await Post.findOne({ where : {id : req.params.postId } });
    if(!post){
      return res.status(401).send('게시글이 존재하지 않습니다');
    }
    await post.addLikers(req.user.id);
    res.json( { PostId : post.id, UserId : req.user.id });
  }catch(error){
    console.error(error);
    next(error);
  }
});

/*좋아요 취소*/
router.delete('/:postId/like', isLoggedIn ,async (req,res,next) =>{
  try{
    const post = await Post.findOne({ where : {id : req.params.postId } });
    if(!post){
      return res.status(401).send('게시글이 존재하지 않습니다');
    }
    await post.removeLikers(req.user.id);
    res.json( { PostId : post.id, UserId : req.user.id });
  }catch(error){
    console.error(error);
    next(error);
  }
});
/*게시글 수정 */
router.patch('/:postId', isLoggedIn ,async (req,res,next) =>{
  try{
    const post = await Post.update({
      content : req.body.content
      },{
      where : {
        id : req.params.postId,
        UserId : req.user.id,
      },
    });
    const hashtags =  req.body.content.match(/(#[^\s#]+)/g);
    if(hashtags){
      const result = await Promise.all(hashtags.map((tag) => Hashtag.findOrCreate({
        where : {name : tag.slice(1).toLowerCase() }
      })));
      await post.addHashtags(result.map((v) => v[0]));
    }
    res.status(200).json({ PostId : parseInt(req.params.postId,10), content : req.body.content });
  }catch(error){
    console.error(error);
    next(error);
  }
});

/*게시글 삭제 */
router.delete('/:postId', isLoggedIn ,async (req,res,next) =>{
  try{
    console.log(req.params.postId);
    await Comment.destroy({
      where :{ PostId : req.params.postId },
    });
    await Post.destroy({
      where : {
        id :req.params.postId ,
        UserId : req.user.id,
      },
    });
    res.status(200).json({ PostId : parseInt(req.params.postId,10) });
  }catch(error){
    console.error(error);
    next(error);
  }
});

//댓글 삭제
router.delete('/:postId', isLoggedIn, async (req, res, next) => { // DELETE /post/10
  try {
    await Post.destroy({
      where: {
        id: req.params.postId,
        UserId: req.user.id,
      },
    });
    res.status(200).json({ PostId: parseInt(req.params.postId, 10) });
  } catch (error) {
    console.error(error);
    next(error);
  }
});

/*게시글 한개 불러오기*/
router.get('/:postId', async (req, res, next) => {
  try {
    const post = await Post.findOne({
      where: { id: req.params.postId },
    });
    if (!post) {
      return res.status(404).send('존재하지 않는 게시글입니다.');
    }
    const fullPost = await Post.findOne({
      where: { id: post.id },
      include: [{
        model: Post,
        as: 'Retweet',
        include: [{
          model: User,
          attributes: ['id', 'nickname'],
        }, {
          model: Image,
        }]
      }, {
        model: User,
        attributes: ['id', 'nickname'],
      }, {
        model: User,
        as: 'Likers',
        attributes: ['id', 'nickname'],
      }, {
        model: Image,
      }, {
        model: Comment,
        include: [{
          model: User,
          attributes: ['id', 'nickname'],
        }],
      }],
    })
    res.status(200).json(fullPost);
  } catch (error) {
    console.error(error);
    next(error);
  }
});

module.exports = router;