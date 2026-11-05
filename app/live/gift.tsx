/**
 * 直播间礼物：图标 + 名字（2026-11-05）。打分榜空的时候、输入页提示、底部滚动条都用这一个。
 *
 * 图在 public/gifts/，从「抖音素材」里的原图裁掉四周空白、缩到 128px 高；墨镜原图带一层几乎透明的灰白底，
 * 放到纸色背景上会露出方块，处理时去掉了。原图「粉丝灯牌」是蓝色长条的粉丝团灯牌，文案里没用到，没放进来。
 * 图标高度跟着字号走（1.25em），四套皮肤、各处字号都不用单独调。
 */

export type GiftName = "灯牌" | "墨镜" | "比心兔兔";

const SRC: Record<GiftName, string> = {
  灯牌: "/gifts/dengpai.png",
  墨镜: "/gifts/mojing.png",
  比心兔兔: "/gifts/bixin-tutu.png",
};

export function Gift({ name }: { name: GiftName }) {
  return (
    <span className="gift">
      <img className="gift-icon" src={SRC[name]} alt="" aria-hidden="true" draggable={false} />「{name}」
    </span>
  );
}
