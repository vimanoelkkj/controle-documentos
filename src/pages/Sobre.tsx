import MockupStyle from "../components/MockupStyle";
import aboutCss from "../mockups/sobre.css?raw";
import aboutHtml from "../mockups/sobre.fragment.html?raw";
export default function Sobre(){return <><MockupStyle css={aboutCss}/><div dangerouslySetInnerHTML={{__html:aboutHtml}} /></>}
